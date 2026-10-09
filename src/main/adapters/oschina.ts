import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'

const HOST = 'https://www.oschina.net'
const SPACE = 'https://my.oschina.net'
const API = 'https://apiv1.oschina.net/oschinapi'
const UPLOAD_URL = `${API}/ai/creation/project/uploadDetail`

interface OscUser {
  userId?: string | number
  userName?: string
  name?: string
  nickName?: string
  nickname?: string
  avatar?: string
  userAvatar?: string
  portrait?: string
}

interface OscCategory {
  id?: string | number
  name?: string
}

interface OscResponse<T> {
  code?: number
  success?: boolean
  message?: string
  result?: T
}

/**
 * 开源中国（OSCHINA）适配器：Cookie 登录态，默认保存草稿。
 * 开源中国无官方开放平台，接口基于对其创作中心（my.oschina.net/blog/write）
 * 前端行为的观察（接口域 apiv1.oschina.net/oschinapi），若失效请对照实际请求调整。
 */
export class OschinaAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'oschina',
    name: '开源中国',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/home/login`

  private cachedUser: OscUser | null = null

  reset(): void {
    this.cachedUser = null
  }

  protected async probe(session: Session): Promise<AuthResult> {
    try {
      const data = await this.fetchUser(session)
      if (data.code === 40001 || data.result?.userId == null) return { isAuthenticated: false }
      const u = data.result
      this.cachedUser = u
      return {
        isAuthenticated: true,
        username: u.userName ?? u.name ?? u.nickName ?? u.nickname,
        avatar: u.avatar ?? u.userAvatar ?? u.portrait
      }
    } catch {
      return { isAuthenticated: false }
    }
  }

  /**
   * 注意：不要用 session.fetch 手动设置 Referer/Origin。
   * Electron 的 net 会校验 referrer 策略，手动设置跨域 Referer 会被
   * Chromium 直接拦截为 net::ERR_BLOCKED_BY_CLIENT（POST 尤其明显）。
   */
  private async fetchUser(session: Session): Promise<OscResponse<OscUser>> {
    const res = await session.fetch(`${API}/user/myDetails`)
    return (await res.json()) as OscResponse<OscUser>
  }

  private async currentUser(): Promise<OscUser> {
    if (this.cachedUser?.userId != null) return this.cachedUser
    const data = await this.fetchUser(this.session)
    if (data.code === 40001 || data.result?.userId == null) {
      throw new Error('开源中国未登录或登录已失效，请重新登录')
    }
    this.cachedUser = data.result
    return this.cachedUser
  }

  private async post<T>(path: string, body: unknown): Promise<OscResponse<T>> {
    const res = await this.session.fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return this.parse<T>(await res.text())
  }

  private async get<T>(path: string): Promise<OscResponse<T>> {
    const res = await this.session.fetch(`${API}${path}`)
    return this.parse<T>(await res.text())
  }

  private parse<T>(text: string): OscResponse<T> {
    try {
      return JSON.parse(text) as OscResponse<T>
    } catch {
      throw new Error(`开源中国接口返回异常: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
    }
  }

  private async listCategories(): Promise<OscCategory[]> {
    const data = await this.get<OscCategory[]>('/blog_catalog/list_by_user')
    if (data.code !== 200) {
      throw new Error(`获取开源中国分类失败${data.message ? `：${data.message}` : ''}`)
    }
    return data.result ?? []
  }

  private async resolveCatalog(name?: string): Promise<string | number> {
    const list = await this.listCategories()
    if (name) {
      const hit = list.find((c) => c.name === name && c.id != null)
      if (hit?.id != null) return hit.id
    }
    const first = list.find((c) => c.id != null)
    if (first?.id != null) return first.id

    const data = await this.post<OscCategory>(
      `/blog_catalog/add?name=${encodeURIComponent(name || '默认分类')}`,
      undefined
    )
    if (data.code !== 200 || data.result?.id == null) {
      throw new Error(`开源中国分类创建失败${data.message ? `：${data.message}` : ''}`)
    }
    return data.result.id
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    const { blob, filename } = await loadImage(input, this.session, baseDir)
    const form = new FormData()
    form.append('file', blob, filename || 'image.png')
    const res = await this.session.fetch(UPLOAD_URL, {
      method: 'POST',
      body: form as unknown as BodyInit
    })
    const data = this.parse<string | { url?: string }>(await res.text())
    const url = typeof data.result === 'string' ? data.result : data.result?.url
    if (!url) {
      throw new Error(`开源中国图片上传失败${data.message ? `：${data.message}` : ''}`)
    }
    return { url }
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    const user = await this.currentUser()
    const userId = user.userId
    const catalog = await this.resolveCatalog(options.category)

    let markdown = article.markdown || ''
    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of markdownImageSrcs(markdown)) {
      if (/oschina\.net|oschina\.osc/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }
    if (mapping.size > 0) markdown = replaceMarkdownImages(markdown, mapping)

    const title = article.title?.trim() || '无标题'
    const payload: Record<string, unknown> = {
      title,
      content: markdown,
      contentType: 1,
      originUrl: '',
      catalog,
      privacy: false,
      disableComment: false,
      user: userId
    }
    const warning =
      failed > 0
        ? `有 ${failed} 张图片未能上传到开源中国图床${firstError ? `（原因：${firstError}）` : ''}`
        : undefined

    if (options.draftOnly === false) {
      const data = await this.post<string | number>('/blog/web/add', {
        ...payload,
        type: '1',
        isAiRelated: false
      })
      if (data.code !== 200 || data.result == null) {
        throw new Error(`开源中国发布失败${data.message ? `：${data.message}` : ''}`)
      }
      const id = String(data.result)
      return this.result({
        success: true,
        postId: id,
        postUrl: `${SPACE}/u/${userId}/blog/${id}`,
        draftOnly: false,
        warning
      })
    }

    const data = await this.post<{ id?: string | number }>('/api/draft/save_draft', payload)
    const draftId = data.result?.id
    if (data.code !== 200 || draftId == null) {
      throw new Error(`开源中国草稿保存失败${data.message ? `：${data.message}` : ''}`)
    }
    return this.result({
      success: true,
      postId: String(draftId),
      postUrl: `${SPACE}/u/${userId}/blog/write`,
      draftOnly: true,
      warning
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
