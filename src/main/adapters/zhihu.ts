import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import { hmacSha1Base64, md5Hex } from './crypto'
import { extractImageSrcs, rewriteImageSrcs } from '@main/markdown/wechat-style'

const HOST = 'https://www.zhihu.com'
const COLUMN = 'https://zhuanlan.zhihu.com'
const API = 'https://api.zhihu.com'

interface ZhihuImageToken {
  upload_file: { state?: number; image_id?: string; object_key: string }
  upload_token: { access_id: string; access_key: string; access_token: string }
}

/**
 * 知乎适配器：Cookie 登录态 + x-requested-with。默认创建草稿。
 * 知乎接口风控较重，若失效请以知乎创作中心网络请求为准调整。
 */
export class ZhihuAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'zhihu',
    name: '知乎',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/signin`

  private ensureHeaders(): void {
    this.installHeaderRules([
      {
        test: /^https?:\/\/(www|zhuanlan|api)\.zhihu\.com\//,
        headers: { 'x-requested-with': 'fetch' }
      },
      {
        test: /^https?:\/\/zhihu-pics-upload\.zhimg\.com\//,
        headers: { Origin: COLUMN, Referer: `${COLUMN}/` }
      }
    ])
  }

  protected async probe(session: Session): Promise<AuthResult> {
    this.ensureHeaders()
    const cookies = await session.cookies.get({ url: HOST })
    if (!cookies.find((c) => c.name === 'z_c0')?.value) return { isAuthenticated: false }
    try {
      const res = await session.fetch(`${HOST}/api/v4/me`, {
        headers: { Referer: `${HOST}/`, 'x-requested-with': 'fetch' }
      })
      const data = (await res.json()) as { id?: string; name?: string; avatar_url?: string }
      if (data?.id) return { isAuthenticated: true, username: data.name, avatar: data.avatar_url }
      return { isAuthenticated: true }
    } catch {
      return { isAuthenticated: true }
    }
  }

  async publish(article: Article, _options: PublishOptions): Promise<SyncResult> {
    this.ensureHeaders()
    const createRes = await this.session.fetch(`${COLUMN}/api/articles/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'fetch',
        Referer: `${COLUMN}/write`
      },
      body: JSON.stringify({ title: article.title, content: '', delta_time: 0 })
    })
    const createText = await createRes.text()
    let created: { id?: number | string }
    try {
      created = JSON.parse(createText)
    } catch {
      throw new Error(`知乎草稿创建失败: ${createRes.status} ${createText.slice(0, 160)}`)
    }
    if (!created.id) throw new Error(`知乎草稿创建失败: ${createText.slice(0, 160)}`)
    const draftId = String(created.id)

    let html = article.html || ''
    const mapping = new Map<string, string>()
    let failed = 0
    let firstError = ''
    for (const src of extractImageSrcs(html)) {
      if (src.includes('zhimg.com')) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch (e) {
        failed++
        if (!firstError) firstError = (e as Error).message
      }
    }
    if (mapping.size > 0) html = rewriteImageSrcs(html, mapping)
    const content = this.transformContent(html)

    const patchRes = await this.session.fetch(`${COLUMN}/api/articles/${draftId}/draft`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'fetch',
        Referer: `${COLUMN}/write`
      },
      body: JSON.stringify({ title: article.title, content })
    })
    if (!patchRes.ok) {
      throw new Error(
        `知乎草稿更新失败: ${patchRes.status} ${(await patchRes.text()).slice(0, 160)}`
      )
    }

    return this.result({
      success: true,
      postId: draftId,
      postUrl: `${COLUMN}/p/${draftId}/edit`,
      draftOnly: true,
      warning:
        failed > 0
          ? `有 ${failed} 张图片未能上传到知乎图床${firstError ? `（原因：${firstError}）` : ''}`
          : undefined
    })
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    if (/^https?:\/\//i.test(input)) {
      const res = await this.session.fetch(`${COLUMN}/api/uploaded_images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'fetch'
        },
        body: new URLSearchParams({ url: input, source: 'article' }).toString()
      })
      const data = (await res.json()) as { src?: string }
      if (data.src) return { url: data.src }
      throw new Error('知乎图片上传失败')
    }

    const { blob, contentType } = await loadImage(input, this.session, baseDir)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = md5Hex(bytes)
    const res = await this.session.fetch(`${API}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify({ image_hash: hash, source: 'article' })
    })
    const data = (await res.json()) as ZhihuImageToken
    if (!data.upload_file) throw new Error('知乎图片凭证获取失败')

    if (data.upload_file.state === 1 && data.upload_file.image_id) {
      const detail = await this.waitForImageReady(data.upload_file.image_id)
      return { url: `https://pic4.zhimg.com/${detail.original_hash}` }
    }

    await this.ossUpload(
      data.upload_file.object_key,
      bytes,
      contentType,
      data.upload_token
    )
    let key = data.upload_file.object_key
    if (contentType === 'image/gif') key += '.gif'
    return { url: `https://pic4.zhimg.com/${key}` }
  }

  private async waitForImageReady(imageId: string): Promise<{ original_hash: string }> {
    for (let i = 0; i < 40; i++) {
      const res = await this.session.fetch(`${API}/images/${imageId}`, {
        headers: { 'x-requested-with': 'fetch' }
      })
      const data = (await res.json()) as {
        status?: string
        original_hash?: string
        original_src?: string
      }
      if (data.original_hash) return { original_hash: data.original_hash }
      if (data.status === 'failed') throw new Error('知乎图片处理失败')
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('知乎图片处理超时')
  }

  private async ossUpload(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
    token: ZhihuImageToken['upload_token']
  ): Promise<void> {
    const endpoint = 'https://zhihu-pics-upload.zhimg.com'
    const url = `${endpoint}/${objectKey}`
    const ossDate = new Date().toUTCString()
    const ossUserAgent = 'aliyun-sdk-js/6.8.0'
    const ossHeaders: Record<string, string> = {
      'x-oss-date': ossDate,
      'x-oss-security-token': token.access_token,
      'x-oss-user-agent': ossUserAgent
    }
    const canonicalizedOSSHeaders = Object.keys(ossHeaders)
      .sort()
      .map((k) => `${k}:${ossHeaders[k]}`)
      .join('\n')
    const canonicalizedResource = `/zhihu-pics/${objectKey}`
    const stringToSign =
      'PUT\n' +
      '\n' +
      `${contentType}\n` +
      `${ossDate}\n` +
      `${canonicalizedOSSHeaders}\n` +
      canonicalizedResource
    const signature = hmacSha1Base64(token.access_key, stringToSign)
    const res = await this.session.fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        Authorization: `OSS ${token.access_id}:${signature}`,
        'x-oss-date': ossDate,
        'x-oss-security-token': token.access_token,
        'x-oss-user-agent': ossUserAgent
      },
      body: bytes as unknown as BodyInit
    })
    if (!res.ok) throw new Error(`知乎图片 OSS 上传失败: ${res.status}`)
  }

  /** 适配知乎编辑器的 HTML 结构 */
  private transformContent(html: string): string {
    let result = html
    result = result.replace(/<img([^>]*?)>/gi, (m) => (m.startsWith('<figure') ? m : `<figure>${m}</figure>`))
    result = this.transformTables(result)
    result = result.replace(/<pre><code class="language-(\w+)">/gi, '<pre lang="$1"><code>')
    result = result.replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '')
    result = result.replace(/\s*style="[^"]*"/gi, '')
    return result
  }

  private transformTables(html: string): string {
    let result = html.replace(/<figure[^>]*>\s*(<table[\s\S]*?<\/table>)\s*<\/figure>/gi, '$1')
    result = result.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
      const thead = inner.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)
      const tbody = inner.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
      let headerRows = ''
      let bodyRows: string
      if (thead) {
        headerRows = thead[1].replace(/<td([^>]*)>/gi, '<th$1>').replace(/<\/td>/gi, '</th>')
      }
      if (tbody) {
        bodyRows = tbody[1]
      } else {
        bodyRows = inner
          .replace(/<thead[^>]*>[\s\S]*?<\/thead>/gi, '')
          .replace(/<\/?tbody[^>]*>/gi, '')
      }
      if (!thead) {
        const firstRow = bodyRows.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)
        if (firstRow && /<th[^>]*>/i.test(firstRow[1]) && !/<td[^>]*>/i.test(firstRow[1])) {
          headerRows = firstRow[0]
          bodyRows = bodyRows.replace(firstRow[0], '')
        }
      }
      return `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody>${headerRows}${bodyRows}</tbody></table>`
    })
    return result
  }
}
