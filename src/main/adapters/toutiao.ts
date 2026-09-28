import type { Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { parse as parseHtml } from 'node-html-parser'
import { CookieAdapter } from './base'
import { loadImage } from './images'
import { extractImageSrcs, rewriteImageSrcs } from '@main/markdown/wechat-style'

const HOST = 'https://mp.toutiao.com'
const PUBLISH_PAGE = `${HOST}/profile_v3/graphic/publish`
const UPLOAD_URL = `${HOST}/mp/agw/article_material/photo/upload_picture?type=ueditor&pgc_watermark=1&action=uploadimage&encode=utf-8`

interface ToutiaoUser {
  id?: string | number
  screen_name?: string
  name?: string
  https_avatar_url?: string
  avatar_url?: string
}

/**
 * 今日头条（头条号）适配器：Cookie 登录态 + X-CSRFToken，默认保存草稿。
 * 头条无官方开放平台，接口基于对创作者平台行为的观察，若失效请对照
 * mp.toutiao.com 的实际请求调整。
 */
export class ToutiaoAdapter extends CookieAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '今日头条',
    homepage: HOST,
    authType: 'cookie',
    capabilities: ['article', 'draft', 'image_upload']
  }

  protected readonly loginUrl = `${HOST}/`

  private ensureHeaders(): void {
    this.installHeaderRules([
      {
        test: /^https?:\/\/mp\.toutiao\.com\//,
        headers: { Origin: HOST, Referer: `${PUBLISH_PAGE}` }
      }
    ])
  }

  private async csrfToken(): Promise<string> {
    const cookies = await this.session.cookies.get({ url: HOST })
    const byName = (n: string): string | undefined => cookies.find((c) => c.name === n)?.value
    const token =
      byName('passport_csrf_token') ??
      byName('passport_csrf_token_default') ??
      byName('csrftoken')
    if (!token) throw new Error('缺少今日头条 csrf token，请重新登录')
    return token
  }

  protected async probe(session: Session): Promise<AuthResult> {
    this.ensureHeaders()
    const cookies = await session.cookies.get({ url: HOST })
    const names = new Set(cookies.map((c) => c.name.toLowerCase()))
    if (!names.has('sessionid') && !names.has('sessionid_ss') && !names.has('sid_tt')) {
      return { isAuthenticated: false }
    }
    try {
      const res = await session.fetch(`${HOST}/mp/agw/media/get_media_info`, {
        headers: { Referer: `${HOST}/` }
      })
      const data = (await res.json()) as { data?: { user?: ToutiaoUser } }
      const user = data?.data?.user
      if (user?.id != null) {
        return {
          isAuthenticated: true,
          username: user.screen_name ?? user.name,
          avatar: user.https_avatar_url ?? user.avatar_url
        }
      }
      return { isAuthenticated: false }
    } catch {
      return { isAuthenticated: false }
    }
  }

  async uploadImage(input: string, baseDir?: string): Promise<{ url: string }> {
    this.ensureHeaders()
    const csrf = await this.csrfToken()
    const { blob, filename } = await loadImage(input, this.session, baseDir)
    const form = new FormData()
    form.append('upfile', blob, filename || 'image.png')
    const res = await this.session.fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'X-CSRFToken': csrf },
      body: form as unknown as BodyInit
    })
    const data = (await res.json()) as {
      state?: string
      url?: string
      web_uri?: string
      message?: string
    }
    if (data.state !== 'SUCCESS' || !data.url) {
      throw new Error(`头条图片上传失败: ${data.message ?? '未知错误'}`)
    }
    return { url: data.url }
  }

  async publish(article: Article, options: PublishOptions): Promise<SyncResult> {
    this.ensureHeaders()
    const csrf = await this.csrfToken()
    // 头条要求先访问发布页建立 referer / 登录上下文
    try {
      await this.session.fetch(PUBLISH_PAGE, { headers: { Referer: `${HOST}/` } })
    } catch {
      /* ignore */
    }

    let html = article.html || ''
    const mapping = new Map<string, string>()
    let failed = 0
    for (const src of extractImageSrcs(html)) {
      if (/toutiaoimg\.com|pstatp\.com|byteimg\.com/i.test(src)) continue
      try {
        const { url } = await this.uploadImage(src, article.baseDir)
        mapping.set(src, url)
      } catch {
        failed++
      }
    }
    if (mapping.size > 0) html = rewriteImageSrcs(html, mapping)
    html = addTrackAttributes(html)

    const params = buildForm(article.title, html, options.summary ?? article.summary ?? '')
    const res = await this.session.fetch(`${HOST}/mp/agw/article/publish?source=mp&type=article`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrf,
        Referer: PUBLISH_PAGE,
        Origin: HOST
      },
      body: params.toString()
    })

    const text = await res.text()
    let data: {
      code?: number
      err_no?: number
      message?: string
      reason?: string
      data?: { pgc_id?: string | number }
    }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`头条接口返回异常: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
    }
    const code = data.code ?? data.err_no
    if (code !== 0) {
      throw new Error(formatError(code, data.message ?? data.reason))
    }
    const pgcId = data.data?.pgc_id
    if (pgcId == null) throw new Error('头条未返回 pgc_id，草稿创建失败')

    return this.result({
      success: true,
      postId: String(pgcId),
      postUrl: `${PUBLISH_PAGE}?pgc_id=${pgcId}`,
      draftOnly: true,
      warning: failed > 0 ? `有 ${failed} 张图片未能上传到头条图床` : undefined
    })
  }
}

/** 头条编辑器要求每个 <p> 带递增的 data-track */
function addTrackAttributes(html: string): string {
  const root = parseHtml(html)
  let index = 1
  for (const p of root.querySelectorAll('p')) {
    p.setAttribute('data-track', String(index++))
  }
  return root.toString()
}

function buildForm(title: string, content: string, abstract: string): URLSearchParams {
  const covers: unknown[] = []
  const params = new URLSearchParams()
  params.set('source', '29')
  params.set('type', 'article')
  params.set('aid', '1231')
  params.set('mp_publish_ab_val', '0')
  params.set('pgc_id', '0')
  params.set('title', title)
  params.set('content', content)
  params.set('article_ad_type', '0')
  params.set('article_type', '0')
  params.set('from_diagnosis', '0')
  params.set('origin_debut_check_pgc_normal', '0')
  params.set('tree_plan_article', '0')
  params.set('save', '1')
  params.set('pgc_feed_covers', JSON.stringify(covers))
  params.set('timer_status', '0')
  params.set('timer_time', '')
  params.set('is_fans_article', '0')
  params.set('govern_forward', '0')
  params.set('praise', '0')
  params.set('disable_praise', '0')
  params.set('star_order_id', '')
  params.set('star_order_name', '')
  params.set('activity_tag', '0')
  params.set('trends_writing_tag', '0')
  params.set('claim_exclusive', '1')
  params.set(
    'search_creation_info',
    JSON.stringify({ searchTopOne: 0, abstract, clue_id: '' })
  )
  params.set('title_id', `${Date.now()}_${Math.floor(Math.random() * 1e16)}`)
  params.set('ic_uri_list', '')
  params.set('appid_list', '')
  params.set('stock_ids', '')
  params.set('concern_list', '')
  params.set('mp_editor_stat', '{}')
  params.set('is_refute_rumor', '0')
  params.set('educluecard', '')
  params.set('draft_form_data', JSON.stringify({ coverType: 2 }))
  params.set(
    'extra',
    JSON.stringify({
      content_source: 100000000402,
      content_word_cnt: content.length,
      is_multi_title: 0,
      sub_titles: [],
      gd_ext: {
        entrance: '',
        from_page: 'publisher_mp',
        enter_from: 'PC',
        device_platform: 'mp',
        is_message: 0
      },
      tuwen_wtt_trans_flag: '2',
      info_source: { source_type: -1 }
    })
  )
  return params
}

function formatError(code: number | undefined, message?: string): string {
  const map: Record<number, string> = {
    [-1]: '系统错误，请稍后重试',
    [-2]: '参数错误',
    8: '签名校验失败（头条接口可能已变更）',
    2010: '账号暂无头条广告权限（建议在后台确认账号权限）',
    2103: '账号需先绑定手机号，请在头条号后台完成绑定后重试',
    7012: '登录态已失效，请重新登录',
    7020: '内容包含违规信息',
    7050: '账号可能未完成实名认证、被限制发布，或内容含敏感词'
  }
  const known = code != null ? map[code] : undefined
  if (known) return `今日头条发布失败：${known}${message ? `（${message}）` : ''}`
  return `今日头条发布失败${message ? `：${message}` : ''}${code != null ? ` (code=${code})` : ''}`
}
