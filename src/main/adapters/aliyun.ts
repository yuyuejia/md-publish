import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'

const HOST = 'https://developer.aliyun.com'
const API = `${HOST}/developer/api`
const EDITOR_URL = `${HOST}/article/new`
const DRAFT_PATH = `/developer/api/articleDraft/putDraft`

interface AliyunUser {
  nickname?: string
  avatar?: string
}

interface AliyunResponse<T> {
  code?: string | number
  success?: boolean
  message?: string
  data?: T
}

interface AliyunUploadUrl {
  uploadUrl?: string
  imageUrl?: string
}

interface AliyunDraftResult {
  aid?: number
}

/**
 * 阿里云开发者社区适配器：Cookie 登录态（阿里云账号），仅保存草稿。
 * 社区无对外开放文档，接口基于对创作中心（developer.aliyun.com/article/new）实际请求的观察：
 * - 登录探测 GET /developer/api/my/user/getUser
 * - 存草稿 POST /developer/api/articleDraft/putDraft?p_csrf=<c_csrf>，返回 data.aid
 * - 图片 POST /developer/api/image/getImageUploadUrl?p_csrf=<c_csrf> 后 PUT uploadUrl
 * 接口可能随改版失效。
 */
export class AliyunAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'aliyun',
    name: '阿里云开发者社区',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = EDITOR_URL

  /**
   * 写接口校验 Origin/Referer，Electron 的 fetch 无法直接设置，
   * 故只对 /developer/api/ 注入（避免影响登录页 account.aliyun.com）。
   */
  private ensureHeaders(): void {
    this.installHeaderRules([
      {
        test: /^https?:\/\/developer\.aliyun\.com\/developer\/api\//,
        headers: { Origin: HOST, Referer: EDITOR_URL }
      }
    ])
  }

  protected async probe(session: Session): Promise<AuthResult> {
    try {
      const res = await session.fetch(`${API}/my/user/getUser`, {
        headers: { Accept: 'application/json' }
      })
      const data = (await res.json()) as AliyunResponse<AliyunUser>
      if (data.success && data.data?.nickname) {
        return {
          isAuthenticated: true,
          username: data.data.nickname,
          avatar: data.data.avatar
        }
      }
      return { isAuthenticated: false }
    } catch {
      return { isAuthenticated: false }
    }
  }

  private async ensureAuth(): Promise<void> {
    const auth = await this.checkAuth()
    if (!auth.isAuthenticated) throw new Error('阿里云开发者社区未登录或登录已失效，请重新登录')
  }

  private async csrfToken(): Promise<string> {
    const cookies = await this.session.cookies.get({ url: HOST })
    const token = cookies.find((c) => c.name === 'c_csrf')?.value
    if (!token) throw new Error('缺少阿里云 c_csrf，请重新登录')
    return token
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    const csrf = await this.csrfToken()
    const { blob, filename, contentType } = await loadImage(input, this.session, baseDir)
    const res = await this.session.fetch(
      `${API}/image/getImageUploadUrl?p_csrf=${encodeURIComponent(csrf)}`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageName: filename || 'image.png', imageSize: blob.size })
      }
    )
    const data = (await res.json()) as AliyunResponse<AliyunUploadUrl>
    const uploadUrl = data.data?.uploadUrl?.replace(/^http:\/\//, 'https://')
    const imageUrl = data.data?.imageUrl
    if (!uploadUrl || !imageUrl) {
      throw new Error(`阿里云图片上传签名失败${data.message ? `：${data.message}` : ''}`)
    }
    const put = await this.session.fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-oss-meta-author': 'ucc', 'content-type': contentType || 'image/png' },
      body: blob as unknown as BodyInit
    })
    if (!put.ok) throw new Error(`阿里云图片上传失败（HTTP ${put.status}）`)
    return { url: imageUrl }
  }

  private async saveDraft(title: string, markdown: string): Promise<number> {
    this.ensureHeaders()
    const csrf = await this.csrfToken()
    const res = await this.session.fetch(`${HOST}${DRAFT_PATH}?p_csrf=${encodeURIComponent(csrf)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8'
      },
      body: JSON.stringify({
        title,
        content: markdown,
        contentRender: '',
        format: null,
        aid: null,
        productTags: [],
        freeTierVOS: []
      })
    })
    const data = (await res.json()) as AliyunResponse<AliyunDraftResult>
    const aid = data.data?.aid
    if (!data.success || aid == null) {
      throw new Error(`阿里云草稿保存失败${data.message ? `：${data.message}` : ''}`)
    }
    return aid
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    await this.ensureAuth()

    let markdown = article.markdown || ''
    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of markdownImageSrcs(markdown)) {
      if (/(^|\/\/)[^/]*aliyuncs\.com|developer\.aliyun\.com/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }
    if (mapping.size > 0) markdown = replaceMarkdownImages(markdown, mapping)

    const warnings: string[] = []
    if (failed > 0) {
      warnings.push(
        `有 ${failed} 张图片未能上传到阿里云图床${firstError ? `（原因：${firstError}）` : ''}`
      )
    }
    if (options.draftOnly === false) {
      warnings.push('阿里云开发者社区暂仅支持保存草稿，已保存为草稿')
    }

    const aid = await this.saveDraft(article.title?.trim() || '无标题', markdown)
    return this.result({
      success: true,
      postId: String(aid),
      postUrl: `${EDITOR_URL}?aid=${aid}`,
      draftOnly: true,
      warning: warnings.length > 0 ? warnings.join('；') : undefined
    })
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
