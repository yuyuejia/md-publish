import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import {
  dropExternalImages,
  extractImageSrcs,
  renderWechatHtml,
  rewriteImageSrcs,
  stripLinksForWechat
} from '@main/markdown/wechat-style'

const HOST = 'https://mp.weixin.qq.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const META_TTL = 10 * 60 * 1000

interface WeixinMeta {
  token: string
  ticket: string
  userName: string
  nickName: string
  svrTime: number
  avatar: string
}

/**
 * 微信公众号适配器：走公众平台后台 Web 接口（Cookie 登录态）。
 * 默认创建草稿，最终群发仍需人工在后台确认。
 *
 * 说明：公众平台后台没有官方文档，本实现基于对后台页面/接口行为的观察，
 * 若失效请对照 mp.weixin.qq.com 的实际网络请求调整。
 */
export class WechatAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'wechat',
    name: '微信公众号',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/`

  private sessionMeta: WeixinMeta | null = null
  private metaAt = 0

  /** cgi-bin 接口需要正确的 Origin / Referer，用 webRequest 注入 */
  private ensureHeaders(): void {
    this.installHeaderRules([
      {
        test: /^https?:\/\/mp\.weixin\.qq\.com\/cgi-bin\//,
        headers: { Origin: HOST, Referer: `${HOST}/` }
      }
    ])
  }

  private static parseMeta(html: string): WeixinMeta | null {
    const token =
      html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/)?.[1] ??
      html.match(/token=(\d+)/)?.[1]
    if (!token) return null
    const svrTime = Number(html.match(/time:\s*["'](\d+)["']/)?.[1])
    return {
      token,
      ticket: html.match(/ticket:\s*["']([^"']+)["']/)?.[1] ?? '',
      userName: html.match(/user_name:\s*["']([^"']+)["']/)?.[1] ?? '',
      nickName: html.match(/nick_name:\s*["']([^"']+)["']/)?.[1] ?? '',
      svrTime: Number.isFinite(svrTime) && svrTime > 0 ? svrTime : Math.floor(Date.now() / 1000),
      avatar:
        html.match(/class="weui-desktop-account__thumb"[^>]*src="([^"]+)"/)?.[1] ??
        html.match(/head_img:\s*['"]([^'"]+)['"]/)?.[1] ??
        ''
    }
  }

  private async fetchMeta(session: Session, force = false): Promise<WeixinMeta> {
    if (!force && this.sessionMeta && Date.now() - this.metaAt < META_TTL) {
      return this.sessionMeta
    }
    const res = await session.fetch(`${HOST}/`, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    })
    const html = await res.text()
    const parsed = WechatAdapter.parseMeta(html)
    if (!parsed) {
      const snippet = html.replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(`未获取到登录信息，请重新登录${snippet ? `｜${snippet}` : ''}`)
    }
    this.sessionMeta = parsed
    this.metaAt = Date.now()
    return parsed
  }

  protected async probe(session: Session): Promise<AuthResult> {
    const cookies = await session.cookies.get({ url: HOST })
    const names = new Set(cookies.map((c) => c.name))
    if (!(names.has('slave_sid') && names.has('slave_user'))) return { isAuthenticated: false }
    try {
      const m = await this.fetchMeta(session, true)
      return { isAuthenticated: true, username: m.nickName || m.userName, avatar: m.avatar }
    } catch (e) {
      return { isAuthenticated: false, error: (e as Error).message }
    }
  }

  reset(): void {
    this.sessionMeta = null
    this.metaAt = 0
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    const m = await this.fetchMeta(this.session)
    const { blob, filename, contentType } = await loadImage(input, this.session, baseDir)
    const stamp = Date.now()
    const name = filename || `${stamp}.jpg`
    const form = new FormData()
    form.append('type', contentType)
    form.append('id', String(stamp))
    form.append('name', name)
    form.append('lastModifiedDate', new Date().toString())
    form.append('size', String(blob.size))
    form.append('file', blob, name)
    const seq = Date.now()
    const url =
      `${HOST}/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite` +
      `&groupid=1&ticket_id=${encodeURIComponent(m.userName)}&ticket=${encodeURIComponent(m.ticket)}` +
      `&svr_time=${m.svrTime}&token=${m.token}&lang=zh_CN&seq=${seq}&t=${Math.random()}`
    const res = await this.session.fetch(url, {
      method: 'POST',
      headers: { Referer: `${HOST}/` },
      body: form as unknown as BodyInit
    })
    const data = (await res.json()) as {
      cdn_url?: string
      base_resp?: { err_msg?: string; ret?: number }
    }
    if (data.base_resp && data.base_resp.err_msg !== 'ok') {
      throw new Error(`微信图片上传失败: ${data.base_resp.err_msg ?? data.base_resp.ret}`)
    }
    if (!data.cdn_url) throw new Error('微信图片上传失败：未返回 cdn_url')
    return { url: data.cdn_url }
  }

  private async createDraft(
    meta: WeixinMeta,
    article: Article,
    content: string,
    options: PublishOptions
  ): Promise<{ appMsgId?: string; error?: string }> {
    const params = new URLSearchParams()
    params.set('token', meta.token)
    params.set('lang', 'zh_CN')
    params.set('f', 'json')
    params.set('ajax', '1')
    params.set('random', String(Math.random()))
    params.set('AppMsgId', '')
    params.set('count', '1')
    params.set('data_seq', '0')
    params.set('operate_from', 'Chrome')
    params.set('isnew', '0')
    params.set('title0', article.title.slice(0, 64))
    params.set('author0', '')
    params.set('digest0', (options.summary ?? article.summary ?? '').slice(0, 120))
    params.set('auto_gen_digest0', '1')
    params.set('content0', content)
    params.set('sourceurl0', '')
    params.set('show_cover_pic0', '0')
    params.set('need_open_comment0', '1')
    params.set('only_fans_can_comment0', '0')
    params.set('copyright_type0', '0')
    params.set('fee0', '0')

    const res = await this.session.fetch(
      `${HOST}/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${meta.token}&lang=zh_CN`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${HOST}/`
        },
        body: params.toString()
      }
    )
    const text = await res.text()
    let data: {
      appMsgId?: string | number
      ret?: number
      base_resp?: { ret?: number; err_msg?: string }
    }
    try {
      data = JSON.parse(text)
    } catch {
      return { error: `微信草稿接口返回异常: ${text.replace(/\s+/g, ' ').slice(0, 200)}` }
    }
    const id = data.appMsgId
    if (id == null) {
      const ret = data.ret ?? data.base_resp?.ret
      return { error: WechatAdapter.formatError(ret, data.base_resp?.err_msg) }
    }
    return { appMsgId: String(id) }
  }

  private static formatError(ret?: number, errMsg?: string): string {
    const map: Record<number, string> = {
      [-1]: '系统错误，请稍后重试',
      [-2]: '参数错误',
      [-6]: '需要输入验证码',
      [-8]: '需要输入验证码',
      [-99]: '内容超出字数限制',
      [-206]: '服务繁忙，请稍后重试',
      [200003]: '登录态超时，请重新登录',
      [412]: '图文中含非法外链',
      [64506]: '保存失败，链接不合法',
      [64507]: '内容不能包含外部链接',
      [64562]: '请勿插入非微信域名的链接',
      [64702]: '标题超出 64 字限制',
      [64703]: '摘要超出 120 字限制',
      [64705]: '内容超出字数，请调整'
    }
    if (ret != null && map[ret]) return map[ret]
    return `微信草稿创建失败${errMsg ? `：${errMsg}` : ''}${ret != null ? ` (ret=${ret})` : ''}`
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    try {
      this.ensureHeaders()
      const meta = await this.fetchMeta(this.session)

      let html = renderWechatHtml(article.html)
      html = stripLinksForWechat(html)

      const srcs = extractImageSrcs(html)
      const mapping = new Map<string, string>()
      let uploadFailed = 0
      let firstError = ''
      for (const src of srcs) {
        if (src.startsWith('data:')) continue
        if (src.includes('mmbiz.qpic.cn') || src.includes('mmbiz.qlogo.cn')) continue
        try {
          const { url } = await this.uploadImage(src, article.baseDir)
          mapping.set(src, url)
        } catch (e) {
          uploadFailed++
          if (!firstError) firstError = (e as Error).message
        }
      }
      if (mapping.size > 0) html = rewriteImageSrcs(html, mapping)

      // 微信不允许非微信域名的图片/链接，未上传成功的图片直接移除
      const cleaned = dropExternalImages(html)
      html = cleaned.html
      const dropped = uploadFailed + cleaned.dropped

      const { appMsgId, error } = await this.createDraft(meta, article, html, options)
      if (!appMsgId) {
        this.sessionMeta = null
        throw new Error(error ?? '微信草稿创建失败')
      }
      const postUrl = `${HOST}/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${appMsgId}&token=${meta.token}&lang=zh_CN`
      return this.result({
        success: true,
        postId: appMsgId,
        postUrl,
        draftOnly: true,
        warning:
          dropped > 0
            ? `有 ${dropped} 张图片未能上传到微信，已从正文中移除${firstError ? `（原因：${firstError}）` : ''}`
            : undefined
      })
    } catch (e) {
      this.sessionMeta = null
      throw e
    }
  }
}
