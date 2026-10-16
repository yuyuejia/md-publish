import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import { getMarkdown } from '@shared/markdown'

const HOST = 'https://cloud.tencent.com'
const WRITE_URL = `${HOST}/developer/article/write-new`
const DRAFT_URL = `${HOST}/developer/api/article/addArticleDraft`
const UPLOAD_INFO_URL = `${HOST}/developer/api/common/cos/upload-info`
const TMP_SECRET_URL = `${HOST}/developer/api/common/cos/tmp-secret`

interface TencentResponse {
  draftId?: number
  code?: number
  msg?: string
}

interface CosUploadInfo {
  bucket?: string
  isPrivateBucket?: boolean
  objectKey?: string
  region?: string
}

interface CosTmpSecret {
  credentials?: { TmpSecretId?: string; TmpSecretKey?: string; Token?: string }
  startTime?: number
  expiredTime?: number
}

interface MdToken {
  type: string
  tag: string
  content: string
  info: string
  children?: MdToken[] | null
  attrGet: (name: string) => string | null
}

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

/**
 * 腾讯云开发者社区适配器：Cookie 登录态，仅保存草稿。
 * 社区无对外开放文档，接口基于对其写作页（cloud.tencent.com/developer/article/write-new）
 * 实际请求的观察：
 * - 存草稿 POST /developer/api/article/addArticleDraft，content 为 ProseMirror 文档 JSON 字符串
 * - 图片：POST /common/cos/upload-info 取对象信息 + /common/cos/tmp-secret 取临时密钥，再签名 PUT 到 COS
 * 接口可能随改版失效。
 */
export class TencentAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'tencent',
    name: '腾讯云开发者社区',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/login?s_url=${encodeURIComponent(WRITE_URL)}`

  /** 写接口校验 Origin/Referer，用 onBeforeSendHeaders 只对社区 API 注入 */
  private ensureHeaders(): void {
    this.installHeaderRules([
      {
        test: /^https?:\/\/cloud\.tencent\.com\/developer\/api\//,
        headers: { Origin: HOST, Referer: WRITE_URL }
      }
    ])
  }

  protected async probe(session: Session): Promise<AuthResult> {
    try {
      const cookies = await session.cookies.get({ url: HOST })
      const byName = (n: string): string | undefined => cookies.find((c) => c.name === n)?.value
      const token = byName('qcommunity_session')
      if (!token) return { isAuthenticated: false }
      const nick = byName('nick')
      return { isAuthenticated: true, username: nick ? safeDecode(nick) : undefined }
    } catch {
      return { isAuthenticated: false }
    }
  }

  private async ensureAuth(): Promise<void> {
    const auth = await this.checkAuth()
    if (!auth.isAuthenticated) throw new Error('腾讯云开发者社区未登录或登录已失效，请重新登录')
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await this.session.fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return (await res.json()) as T
  }

  /** 上传图片到腾讯云 COS，返回带签名的访问 URL */
  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    const { blob, filename, contentType } = await loadImage(input, this.session, baseDir)
    const extension = (filename.split('.').pop() ?? contentType.split('/').pop() ?? 'png').toLowerCase()

    const info = await this.postJson<CosUploadInfo>(UPLOAD_INFO_URL, {
      scene: 'editor.image',
      extension
    })
    const { bucket, region, objectKey } = info
    if (!bucket || !region || !objectKey) throw new Error('腾讯云图片上传失败：无法获取上传信息')

    const secret = await this.postJson<CosTmpSecret>(TMP_SECRET_URL, { objectKey })
    const cred = secret.credentials
    if (!cred?.TmpSecretId || !cred.TmpSecretKey || !cred.Token) {
      throw new Error('腾讯云图片上传失败：无法获取临时密钥')
    }

    const cosHost = `${bucket}.cos.${region}.myqcloud.com`
    const path = objectKey.startsWith('/') ? objectKey : `/${objectKey}`
    const now = Math.floor(Date.now() / 1000)

    const putAuth = cosAuthorization({
      method: 'put',
      path,
      headers: { 'content-length': String(blob.size), host: cosHost },
      secretId: cred.TmpSecretId,
      secretKey: cred.TmpSecretKey,
      keyTime: `${now};${now + 3600}`
    })
    const put = await this.session.fetch(`https://${cosHost}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: putAuth,
        'x-cos-security-token': cred.Token,
        'Content-Type': contentType || 'image/png'
      },
      body: blob as unknown as BodyInit
    })
    if (!put.ok) throw new Error(`腾讯云图片上传失败（HTTP ${put.status}）`)

    const getAuth = cosAuthorization({
      method: 'get',
      path,
      headers: { host: cosHost },
      secretId: cred.TmpSecretId,
      secretKey: cred.TmpSecretKey,
      keyTime: `${now};${now + 7200}`
    })
    return { url: `https://${cosHost}${path}?${getAuth}&x-cos-security-token=${cred.Token}` }
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    await this.ensureAuth()
    this.ensureHeaders()

    const markdown = article.markdown || ''
    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of markdownImageSrcs(markdown)) {
      if (/myqcloud\.com|qcloudimg\.com|cloud\.tencent\.com/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }

    const warnings: string[] = []
    if (failed > 0) {
      warnings.push(
        `有 ${failed} 张图片未能上传到腾讯云图床${firstError ? `（原因：${firstError}）` : ''}`
      )
    }
    if (options.draftOnly === false) {
      warnings.push('腾讯云开发者社区暂仅支持保存草稿，已保存为草稿')
    }

    const body = {
      articleId: 0,
      title: article.title?.trim() || '无标题',
      content: markdownToProseMirror(markdown, mapping),
      plain: plainText(markdown),
      sourceType: 0,
      classifyIds: [] as number[],
      tagIds: [] as number[],
      longtailTag: options.tags ?? article.tags ?? [],
      columnIds: [] as number[],
      openComment: 1,
      closeTextLink: 0,
      userSummary: options.summary ?? article.summary ?? '',
      pic: article.cover ?? '',
      sourceDetail: {},
      zoneName: '',
      summary: ''
    }

    const data = await this.postJson<TencentResponse>(DRAFT_URL, body)
    if (data.code || data.draftId == null) {
      throw new Error(`腾讯云开发者社区草稿保存失败${data.msg ? `：${data.msg}` : ''}`)
    }
    return this.result({
      success: true,
      postId: String(data.draftId),
      postUrl: `${WRITE_URL}?draftId=${data.draftId}`,
      draftOnly: true,
      warning: warnings.length > 0 ? warnings.join('；') : undefined
    })
  }
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function sha1Hex(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex')
}

function hmacSha1Hex(key: string, message: string): string {
  return createHmac('sha1', key).update(message, 'utf8').digest('hex')
}

/**
 * 腾讯云 COS 请求签名（v5，sha1），返回鉴权串。
 * 用作 PUT 的 Authorization 头，或拼到 GET URL 的 query 上。
 */
function cosAuthorization(opts: {
  method: string
  path: string
  headers: Record<string, string>
  secretId: string
  secretKey: string
  keyTime: string
}): string {
  const { method, path, headers, secretId, secretKey, keyTime } = opts
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const keys = Object.keys(lower).sort()
  const headerList = keys.join(';')
  const headerStr = keys.map((k) => `${k}=${encodeURIComponent(lower[k])}`).join('&')
  const httpString = `${method.toLowerCase()}\n${path}\n\n${headerStr}\n`
  const signKey = hmacSha1Hex(secretKey, keyTime)
  const signature = hmacSha1Hex(signKey, `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`)
  return (
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`
  )
}

function uid(): string {
  return randomUUID()
}

function blockAttrs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uid(),
    textAlign: 'inherit',
    indent: 0,
    color: null,
    background: null,
    isHoverDragHandle: false,
    ...extra
  }
}

/** 把 Markdown 转成腾讯云社区编辑器使用的 ProseMirror 文档 JSON 字符串 */
function markdownToProseMirror(src: string, mapping: Map<string, string>): string {
  const tokens = getMarkdown().parse(src || '', {}) as unknown as MdToken[]
  const doc: PMNode = { type: 'doc', content: [] }
  const stack: PMNode[] = [doc]

  const top = (): PMNode => stack[stack.length - 1]
  const add = (node: PMNode): void => {
    if (!top().content) top().content = []
    top().content!.push(node)
  }
  const open = (type: string, attrs?: Record<string, unknown>): void => {
    const node: PMNode = { type, content: [] }
    if (attrs) node.attrs = attrs
    add(node)
    stack.push(node)
  }

  for (const t of tokens) {
    switch (t.type) {
      case 'heading_open':
        open('heading', {
          id: uid(),
          textAlign: 'inherit',
          indent: 0,
          level: Number(t.tag.slice(1)) || 1,
          isHoverDragHandle: false
        })
        break
      case 'paragraph_open':
        open('paragraph', blockAttrs())
        break
      case 'blockquote_open':
        open('blockquote', { id: uid(), textAlign: 'inherit', isHoverDragHandle: false })
        break
      case 'bullet_list_open':
        open('bulletList', { id: uid() })
        break
      case 'ordered_list_open':
        open('orderedList', { id: uid() })
        break
      case 'list_item_open':
        open('listItem', { id: uid() })
        break
      case 'heading_close':
      case 'paragraph_close':
      case 'blockquote_close':
      case 'bullet_list_close':
      case 'ordered_list_close':
      case 'list_item_close':
        if (stack.length > 1) stack.pop()
        break
      case 'inline':
        for (const node of inlineNodes(t.children ?? [], mapping)) add(node)
        break
      case 'fence':
        add(codeBlockNode(t.content, (t.info || '').trim().split(/\s+/)[0] || ''))
        break
      case 'code_block':
        add(codeBlockNode(t.content, ''))
        break
      case 'hr':
        add({ type: 'horizontalRule', attrs: { id: uid() } })
        break
      default:
        break
    }
  }

  return JSON.stringify(doc)
}

function inlineNodes(children: MdToken[], mapping: Map<string, string>): PMNode[] {
  const out: PMNode[] = []
  const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []
  const removeMark = (type: string): void => {
    const idx = marks.map((m) => m.type).lastIndexOf(type)
    if (idx >= 0) marks.splice(idx, 1)
  }
  for (const c of children) {
    switch (c.type) {
      case 'text':
        if (c.content)
          out.push({ type: 'text', text: c.content, ...(marks.length ? { marks: [...marks] } : {}) })
        break
      case 'strong_open':
        marks.push({ type: 'bold' })
        break
      case 'strong_close':
        removeMark('bold')
        break
      case 'em_open':
        marks.push({ type: 'italic' })
        break
      case 'em_close':
        removeMark('italic')
        break
      case 's_open':
        marks.push({ type: 'strike' })
        break
      case 's_close':
        removeMark('strike')
        break
      case 'code_inline':
        out.push({ type: 'text', text: c.content, marks: [...marks, { type: 'code' }] })
        break
      case 'link_open':
        marks.push({
          type: 'link',
          attrs: {
            href: c.attrGet('href') || '',
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            class: null
          }
        })
        break
      case 'link_close':
        removeMark('link')
        break
      case 'image':
        out.push(imageNode(c.attrGet('src') || '', c.attrGet('title') || '', mapping))
        break
      case 'softbreak':
        out.push({ type: 'text', text: ' ' })
        break
      case 'hardbreak':
        out.push({ type: 'hardBreak' })
        break
      default:
        break
    }
  }
  return out
}

function codeBlockNode(code: string, language: string): PMNode {
  return {
    type: 'codeBlock',
    attrs: {
      id: uid(),
      language,
      theme: 'atom-one-dark',
      runtimes: 0,
      isHoverDragHandle: false,
      key: uid().slice(0, 5),
      languageByAi: language
    },
    content: [{ type: 'text', text: code.replace(/\n$/, '') }]
  }
}

function imageNode(src: string, title: string, mapping: Map<string, string>): PMNode {
  const finalSrc = resolveUploaded(src, mapping)
  const extension = (finalSrc.split('?')[0].split('.').pop() ?? '').toLowerCase()
  return {
    type: 'image',
    attrs: {
      id: uid(),
      src: finalSrc,
      extension,
      align: 'center',
      alt: title,
      showAlt: false,
      href: '',
      boxShadow: '',
      width: 504,
      aspectRatio: '1.000000',
      status: 'success',
      showText: false,
      isPercentage: false,
      percentage: 0,
      isHoverDragHandle: false
    }
  }
}

function plainText(src: string): string {
  const tokens = getMarkdown().parse(src || '', {}) as unknown as MdToken[]
  let out = ''
  for (const t of tokens) {
    if (t.type === 'inline' && t.children) {
      for (const c of t.children) {
        if (c.type === 'text' || c.type === 'code_inline') out += c.content
        else if (c.type === 'softbreak' || c.type === 'hardbreak') out += '\n'
      }
      out += '\n'
    } else if (t.type === 'fence' || t.type === 'code_block') {
      out += t.content
    }
  }
  return out.trim()
}

function markdownImageSrcs(markdown: string): string[] {
  const re = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
  const urls = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown))) urls.add(m[1])
  return [...urls]
}

/** markdown-it 会把图片 src 做 URL 编码，需按原始/编码/解码多种形态匹配上传结果 */
function resolveUploaded(src: string, mapping: Map<string, string>): string {
  if (!src) return src
  const candidates = new Set<string>([src])
  try {
    candidates.add(decodeURIComponent(src))
  } catch {
    /* ignore */
  }
  try {
    candidates.add(encodeURI(src))
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    const hit = mapping.get(c)
    if (hit) return hit
  }
  return src
}
