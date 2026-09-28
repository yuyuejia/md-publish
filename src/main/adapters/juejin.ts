import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import { crc32Hex, signAWS4 } from './crypto'

const HOST = 'https://juejin.cn'
const API = 'https://api.juejin.cn'
const IMAGEX_HOST = 'https://imagex.bytedanceapi.com'
const IMAGEX_AID = '2608'
const IMAGEX_SERVICE_ID = '73owjymdk6'

interface ImageXToken {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiresAt: number
}

interface ImageXUploadAddress {
  StoreInfos: Array<{ StoreUri: string; Auth: string }>
  UploadHosts: string[]
  SessionKey: string
}

/**
 * 稀土掘金适配器：使用 Web 登录态调用掘金内容接口，默认存草稿。
 * 掘金无官方开放平台，接口若失效请对照掘金编辑器网络请求调整。
 */
export class JuejinAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'juejin',
    name: '稀土掘金',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/login`

  private cachedCsrf: string | null = null
  private cachedImageToken: ImageXToken | null = null
  private uuid = `${Math.random().toString(16).slice(2)}${Date.now()}`

  private ensureHeaders(): void {
    const headers = { Origin: HOST, Referer: `${HOST}/` }
    this.installHeaderRules([
      { test: /^https?:\/\/api\.juejin\.cn\//, headers },
      { test: /^https?:\/\/imagex\.bytedanceapi\.com\//, headers }
    ])
  }

  reset(): void {
    this.cachedCsrf = null
    this.cachedImageToken = null
  }

  protected async probe(session: Session): Promise<AuthResult> {
    this.ensureHeaders()
    const cookies = await session.cookies.get({ url: HOST })
    if (!cookies.find((c) => c.name === 'sessionid')?.value) return { isAuthenticated: false }
    try {
      const res = await session.fetch(`${API}/user_api/v1/user/get`, {
        headers: { Referer: `${HOST}/` }
      })
      const data = (await res.json()) as {
        err_no?: number
        data?: { user_id?: string; user_name?: string; avatar_large?: string }
      }
      if (data.data?.user_id) {
        return {
          isAuthenticated: true,
          username: data.data.user_name,
          avatar: data.data.avatar_large
        }
      }
      return { isAuthenticated: data.err_no === 0 }
    } catch {
      return { isAuthenticated: true }
    }
  }

  private async csrfToken(): Promise<string> {
    if (this.cachedCsrf) return this.cachedCsrf
    const res = await this.session.fetch(`${API}/user_api/v1/sys/token`, {
      method: 'HEAD',
      headers: {
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.10',
        Referer: `${HOST}/`
      }
    })
    const ware = res.headers.get('x-ware-csrf-token')
    if (!ware) throw new Error('获取掘金 CSRF token 失败（请重新登录）')
    const parts = ware.split(',')
    if (parts.length < 2) throw new Error('掘金 CSRF token 格式异常')
    this.cachedCsrf = parts[1]
    return this.cachedCsrf
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const csrf = await this.csrfToken()
    const res = await this.session.fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-secsdk-csrf-token': csrf,
        Referer: `${HOST}/`
      },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    let data: { err_no?: number; err_msg?: string; data?: unknown }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`掘金接口返回异常: ${text.slice(0, 200)}`)
    }
    if (data.err_no && data.err_no !== 0) {
      throw new Error(`掘金接口错误: ${data.err_msg ?? '未知'} (err_no=${data.err_no})`)
    }
    return data as T
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    this.ensureHeaders()
    const { markdown, failed, firstError } = await this.processMarkdownImages(
      article.markdown || '',
      article.baseDir
    )

    const res = await this.apiPost<{ data?: { id?: string } }>(
      '/content_api/v1/article_draft/create',
      {
        brief_content: options.summary ?? article.summary ?? '',
        category_id: '0',
        cover_image: '',
        edit_type: 10,
        html_content: 'deprecated',
        link_url: '',
        mark_content: markdown,
        tag_ids: [],
        title: article.title
      }
    )
    const draftId = res.data?.id
    if (!draftId) throw new Error('掘金草稿创建失败：未返回 draft_id')

    return this.result({
      success: true,
      postId: String(draftId),
      postUrl: `${HOST}/editor/drafts/${draftId}`,
      draftOnly: true,
      warning:
        failed > 0
          ? `有 ${failed} 张图片未能上传到掘金图床${firstError ? `（原因：${firstError}）` : ''}`
          : undefined
    })
  }

  /** 将 Markdown 中的图片逐个上传到掘金图床，返回替换后的文本与失败数 */
  private async processMarkdownImages(
    markdown: string,
    baseDir?: string
  ): Promise<{ markdown: string; failed: number; firstError: string }> {
    const re = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
    const urls = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(markdown))) urls.add(m[1])

    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of urls) {
      if (/juejin\.cn|juejin\.com|byteimg\.com/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }
    let next = markdown
    for (const [from, to] of mapping) next = next.split(from).join(to)
    return { markdown: next, failed, firstError }
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    const { blob } = await loadImage(input, this.session, baseDir)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    const token = await this.imageXToken()
    const uploadAddress = await this.applyUpload(token)
    const storeInfo = uploadAddress.StoreInfos[0]
    const uploadHost = uploadAddress.UploadHosts[0]
    if (!storeInfo || !uploadHost) throw new Error('掘金图床申请上传失败')

    const putRes = await this.session.fetch(`https://${uploadHost}/${storeInfo.StoreUri}`, {
      method: 'PUT',
      headers: {
        Authorization: storeInfo.Auth,
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-CRC32': crc32Hex(bytes)
      },
      body: bytes as unknown as BodyInit
    })
    if (!putRes.ok) throw new Error(`掘金图床上传失败: ${putRes.status}`)

    await this.commitUpload(token, uploadAddress.SessionKey)
    return { url: await this.imageUrl(storeInfo.StoreUri) }
  }

  private async imageXToken(): Promise<ImageXToken> {
    if (this.cachedImageToken && Date.now() < this.cachedImageToken.expiresAt - 60000) {
      return this.cachedImageToken
    }
    const res = await this.session.fetch(
      `${API}/imagex/v2/gen_token?aid=${IMAGEX_AID}&uuid=${this.uuid}&client=web`,
      { headers: { Referer: `${HOST}/` } }
    )
    const data = (await res.json()) as {
      err_no?: number
      err_msg?: string
      data?: {
        token?: {
          AccessKeyId: string
          SecretAccessKey: string
          SessionToken: string
          ExpiredTime: string
        }
      }
    }
    const t = data.data?.token
    if (data.err_no && data.err_no !== 0) throw new Error(data.err_msg ?? '获取掘金图床凭证失败')
    if (!t) throw new Error('获取掘金图床凭证失败')
    this.cachedImageToken = {
      accessKeyId: t.AccessKeyId,
      secretAccessKey: t.SecretAccessKey,
      sessionToken: t.SessionToken,
      expiresAt: new Date(t.ExpiredTime).getTime()
    }
    return this.cachedImageToken
  }

  private async applyUpload(token: ImageXToken): Promise<ImageXUploadAddress> {
    const url = `${IMAGEX_HOST}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${IMAGEX_SERVICE_ID}`
    const { headers } = signAWS4({
      method: 'GET',
      url,
      accessKeyId: token.accessKeyId,
      secretAccessKey: token.secretAccessKey,
      securityToken: token.sessionToken
    })
    const res = await this.session.fetch(url, { headers })
    const data = (await res.json()) as { Result?: { UploadAddress?: ImageXUploadAddress } }
    const addr = data.Result?.UploadAddress
    if (!addr) throw new Error('掘金图床 ApplyUpload 失败')
    return addr
  }

  private async commitUpload(token: ImageXToken, sessionKey: string): Promise<void> {
    const url = `${IMAGEX_HOST}/?Action=CommitImageUpload&Version=2018-08-01&SessionKey=${encodeURIComponent(sessionKey)}&ServiceId=${IMAGEX_SERVICE_ID}`
    const { headers } = signAWS4({
      method: 'POST',
      url,
      accessKeyId: token.accessKeyId,
      secretAccessKey: token.secretAccessKey,
      securityToken: token.sessionToken
    })
    const res = await this.session.fetch(url, {
      method: 'POST',
      headers,
      body: ''
    })
    if (!res.ok) throw new Error(`掘金图床 CommitUpload 失败: ${res.status}`)
  }

  private async imageUrl(storeUri: string): Promise<string> {
    const res = await this.session.fetch(
      `${API}/imagex/v2/get_img_url?aid=${IMAGEX_AID}&uuid=${this.uuid}&uri=${encodeURIComponent(storeUri)}&img_type=private`,
      { headers: { Referer: `${HOST}/` } }
    )
    const data = (await res.json()) as {
      err_no?: number
      err_msg?: string
      data?: { main_url?: string; backup_url?: string }
    }
    const url = data.data?.main_url || data.data?.backup_url
    if (!url) throw new Error(data.err_msg ?? '获取掘金图片地址失败')
    return url
  }
}
