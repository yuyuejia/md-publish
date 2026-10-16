import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import { hmacSha256Base64 } from './crypto'
import { rewriteImageSrcs } from '@main/markdown/wechat-style'

const HOST = 'https://www.csdn.net'
const EDITOR = 'https://editor.csdn.net/md'
const GATEWAY = 'https://bizapi.csdn.net'
const SAVE_PATH = '/blog-console-api/v3/mdeditor/saveArticle'
const UPLOAD_SIGN_PATH = '/resource-api/v1/image/direct/upload/signature'

// bizapi.csdn.net 走阿里云 API 网关，请求需带 x-ca-* 签名头。
// 两组 appKey/appSecret 与 Accept/Content-Type 均取自编辑器前端 bundle，轮换后需重新提取：
// - blog-console-api（保存文章，编辑器自带 XMLHttpRequest 封装）：Accept `*/*`、Content-Type `application/json`，只签 key + nonce
// - resource-api（图片上传，csdn-http.js 的 axios 封装）：Accept `application/json, text/plain, */*`、Content-Type `application/json;charset=UTF-8`，签 key + nonce + timestamp
const BLOG_KEY = '203803574'
const BLOG_SECRET = '9znpamsyl2c7cdrr9sas0le9vbc3r6ba'
const BLOG_ACCEPT = '*/*'
const BLOG_CONTENT_TYPE = 'application/json'
const RESOURCE_KEY = '260196572'
const RESOURCE_SECRET = 't5PaqxVQpWoHgLGt7XPIvd5ipJcwJTU7'
const RESOURCE_ACCEPT = 'application/json, text/plain, */*'
const RESOURCE_CONTENT_TYPE = 'application/json;charset=UTF-8'

interface CsdnResponse<T> {
  code?: number
  message?: string
  msg?: string
  data?: T
}

interface CsdnSaveResult {
  id?: string | number
  article_id?: string | number
}

interface UploadSignature {
  provider?: string
  filePath?: string
  policy?: string
  signature?: string
  callbackBody?: string
  callbackBodyType?: string
  callbackUrl?: string
  accessId?: string
  host?: string
  customParam?: Record<string, unknown>
}

/**
 * CSDN 博客适配器：Cookie 登录态，仅保存草稿。
 * CSDN 无官方开放平台，接口基于对创作中心（editor.csdn.net/md）行为的观察：
 * - 保存草稿 POST bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle
 * - 图片先取直传签名（resource-api），再由 OSS/OBS 直传
 * 接口走阿里云 API 网关（x-ca-* 签名），若失效请对照编辑器实际请求调整。
 */
export class CsdnAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'csdn',
    name: 'CSDN',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${EDITOR}/`

  protected async probe(session: Session): Promise<AuthResult> {
    try {
      const cookies = await session.cookies.get({ url: HOST })
      const byName = (n: string): string | undefined =>
        cookies.find((c) => c.name === n)?.value
      const token = byName('UserToken')
      if (!token) return { isAuthenticated: false }
      const raw = byName('UserNick') ?? byName('UserName')
      return { isAuthenticated: true, username: raw ? safeDecode(raw) : undefined }
    } catch {
      return { isAuthenticated: false }
    }
  }

  private async ensureAuth(): Promise<void> {
    const auth = await this.checkAuth()
    if (!auth.isAuthenticated) throw new Error('CSDN 未登录或登录已失效，请重新登录')
  }

  /**
   * 阿里云 API 网关签名：字符串为
   *   METHOD\nAccept\n{Content-MD5}\nContent-Type\n{Date}\n<签名头 key:value>\n<path>
   * 其中 Content-MD5 / Date 为空。签名头按 key 升序排列。
   * 注意：不要用 session.fetch 手动设置跨域 Referer/Origin，
   * Chromium 的 referrer 策略会直接拦截 POST（net::ERR_BLOCKED_BY_CLIENT）。
   */
  private sign(
    method: string,
    path: string,
    secret: string,
    headers: Array<[string, string]>,
    accept: string,
    contentType: string
  ): string {
    let s = `${method.toUpperCase()}\n${accept}\n\n${contentType}\n\n`
    for (const [k, v] of [...headers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      s += `${k}:${v}\n`
    }
    return hmacSha256Base64(secret, s + path)
  }

  private blogHeaders(path: string): Record<string, string> {
    const nonce = randomUUID()
    const signature = this.sign(
      'POST',
      path,
      BLOG_SECRET,
      [
        ['x-ca-key', BLOG_KEY],
        ['x-ca-nonce', nonce]
      ],
      BLOG_ACCEPT,
      BLOG_CONTENT_TYPE
    )
    return {
      Accept: BLOG_ACCEPT,
      'Content-Type': BLOG_CONTENT_TYPE,
      'X-Ca-Key': BLOG_KEY,
      'X-Ca-Nonce': nonce,
      'X-Ca-Signature': signature,
      'X-Ca-Signature-Headers': 'x-ca-key,x-ca-nonce'
    }
  }

  private resourceHeaders(path: string): Record<string, string> {
    const nonce = randomUUID()
    const timestamp = String(Date.now())
    const signature = this.sign(
      'POST',
      path,
      RESOURCE_SECRET,
      [
        ['x-ca-key', RESOURCE_KEY],
        ['x-ca-nonce', nonce],
        ['x-ca-timestamp', timestamp]
      ],
      RESOURCE_ACCEPT,
      RESOURCE_CONTENT_TYPE
    )
    return {
      Accept: RESOURCE_ACCEPT,
      'Content-Type': RESOURCE_CONTENT_TYPE,
      'X-Ca-Key': RESOURCE_KEY,
      'X-Ca-Nonce': nonce,
      'X-Ca-Timestamp': timestamp,
      'X-Ca-Signature': signature,
      'X-Ca-Signature-Headers': 'x-ca-key,x-ca-nonce,x-ca-timestamp'
    }
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    const { blob, filename, contentType } = await loadImage(input, this.session, baseDir)
    const suffix = (filename.split('.').pop() ?? contentType.split('/').pop() ?? 'png').toLowerCase()

    const sigRes = await this.session.fetch(`${GATEWAY}${UPLOAD_SIGN_PATH}`, {
      method: 'POST',
      headers: this.resourceHeaders(UPLOAD_SIGN_PATH),
      body: JSON.stringify({ imageTemplate: '', appName: 'direct_blog', imageSuffix: suffix })
    })
    const sig = await this.parse<UploadSignature>(await sigRes.text())
    const d = sig.data
    if (sig.code !== 200 || !d?.host || !d.filePath) {
      throw new Error(`CSDN 图片上传签名失败${sig.message ? `：${sig.message}` : ''}`)
    }

    const form = new FormData()
    form.append('key', d.filePath)
    form.append('policy', d.policy ?? '')
    form.append('signature', d.signature ?? '')
    form.append('callbackBody', d.callbackBody ?? '')
    form.append('callbackBodyType', d.callbackBodyType ?? '')
    if (d.provider === 'obs') {
      form.append('callbackUrl', d.callbackUrl ?? '')
      form.append('AccessKeyId', d.accessId ?? '')
    } else {
      form.append('callback', d.callbackUrl ?? '')
      form.append('OSSAccessKeyId', d.accessId ?? '')
    }
    for (const [k, v] of Object.entries(d.customParam ?? {})) form.append(`x:${k}`, String(v))
    form.append('file', blob, filename || `image.${suffix}`)

    const res = await this.session.fetch(d.host, {
      method: 'POST',
      body: form as unknown as BodyInit
    })
    const out = await this.parse<{ imageUrl?: string; url?: string }>(await res.text())
    const url = out.data?.imageUrl ?? out.data?.url
    if (out.code !== 200 || !url) {
      throw new Error(`CSDN 图片上传失败${out.message ? `：${out.message}` : ''}`)
    }
    return { url }
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    await this.ensureAuth()

    let markdown = article.markdown || ''
    let html = article.html || ''
    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of markdownImageSrcs(markdown)) {
      if (/csdnimg\.cn|csdn\.net/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }
    if (mapping.size > 0) {
      markdown = replaceMarkdownImages(markdown, mapping)
      html = rewriteImageSrcs(html, mapping)
    }

    const warnings: string[] = []
    if (failed > 0) {
      warnings.push(
        `有 ${failed} 张图片未能上传到 CSDN 图床${firstError ? `（原因：${firstError}）` : ''}`
      )
    }
    if (options.draftOnly === false) warnings.push('CSDN 暂仅支持保存草稿，已保存为草稿')

    const payload: Record<string, unknown> = {
      title: article.title?.trim() || '无标题',
      markdowncontent: markdown,
      content: html,
      readType: 'public',
      level: 1,
      tags: (options.tags ?? article.tags ?? []).join(','),
      categories: options.category ?? options.column ?? '',
      status: 2,
      type: 'original',
      original_link: '',
      Description: options.summary ?? article.summary ?? '',
      not_auto_saved: '1',
      source: 'pc_mdeditor',
      is_new: 1,
      vote_id: 0,
      resource_id: '',
      pubStatus: 'draft',
      creation_statement: 0
    }

    const res = await this.session.fetch(`${GATEWAY}${SAVE_PATH}`, {
      method: 'POST',
      headers: this.blogHeaders(SAVE_PATH),
      body: JSON.stringify(payload)
    })
    const data = await this.parse<CsdnSaveResult>(await res.text())
    const id = data.data?.id ?? data.data?.article_id
    if (data.code !== 200 || id == null) {
      const detail = data.message ?? data.msg
      throw new Error(`CSDN 草稿保存失败${detail ? `：${detail}` : ''}`)
    }
    return this.result({
      success: true,
      postId: String(id),
      postUrl: `${EDITOR}/?articleId=${id}`,
      draftOnly: true,
      warning: warnings.length > 0 ? warnings.join('；') : undefined
    })
  }

  private async parse<T>(text: string): Promise<CsdnResponse<T>> {
    try {
      return JSON.parse(text) as CsdnResponse<T>
    } catch {
      throw new Error(`CSDN 接口返回异常: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
    }
  }
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function markdownImageSrcs(markdown: string): string[] {
  const re = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
  const urls = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown))) urls.add(m[1])
  return [...urls]
}

function replaceMarkdownImages(markdown: string, mapping: Map<string, string>): string {
  let next = markdown
  for (const [from, to] of mapping) next = next.split(from).join(to)
  return next
}
