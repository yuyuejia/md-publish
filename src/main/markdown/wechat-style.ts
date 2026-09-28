import { parse } from 'node-html-parser'

export interface WechatTheme {
  name: string
  container: string
  h1: string
  h2: string
  h3: string
  h4: string
  p: string
  a: string
  ul: string
  ol: string
  li: string
  blockquote: string
  code: string
  pre: string
  img: string
  table: string
  th: string
  td: string
  hr: string
}

const base: WechatTheme = {
  name: 'default',
  container:
    'font-size:15px;line-height:1.75;color:#333;word-break:break-word;text-align:left;letter-spacing:0.5px;',
  h1: 'font-size:22px;font-weight:bold;margin:24px 0 16px;line-height:1.4;color:#222;',
  h2: 'font-size:19px;font-weight:bold;margin:22px 0 14px;line-height:1.4;color:#222;',
  h3: 'font-size:17px;font-weight:bold;margin:20px 0 12px;line-height:1.4;color:#222;',
  h4: 'font-size:16px;font-weight:bold;margin:18px 0 10px;line-height:1.4;color:#222;',
  p: 'margin:14px 0;line-height:1.75;color:#333;',
  a: 'color:#576b95;text-decoration:none;',
  ul: 'margin:14px 0;padding-left:26px;list-style-type:disc;',
  ol: 'margin:14px 0;padding-left:26px;list-style-type:decimal;',
  li: 'margin:6px 0;line-height:1.75;color:#333;',
  blockquote:
    'margin:16px 0;padding:10px 16px;border-left:3px solid #d0d0d0;background:#f7f7f7;color:#666;',
  code: 'font-family:Menlo,Consolas,monospace;font-size:13px;background:#f2f3f5;padding:2px 5px;border-radius:3px;color:#c7254e;',
  pre: 'margin:16px 0;padding:14px 16px;background:#282c34;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.6;color:#abb2bf;',
  img: 'max-width:100%;height:auto;display:block;margin:16px auto;border-radius:4px;',
  table: 'width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;',
  th: 'border:1px solid #e0e0e0;padding:8px 10px;background:#f7f7f7;font-weight:bold;text-align:left;',
  td: 'border:1px solid #e0e0e0;padding:8px 10px;text-align:left;',
  hr: 'border:none;border-top:1px solid #e0e0e0;margin:24px 0;'
}

export const wechatThemes: Record<string, WechatTheme> = {
  default: base,
  green: {
    ...base,
    name: 'green',
    h1: `${base.h1}color:#2e7d32;`,
    h2: `${base.h2}color:#2e7d32;border-left:4px solid #4caf50;padding-left:10px;`,
    h3: `${base.h3}color:#388e3c;`,
    a: 'color:#2e7d32;text-decoration:none;',
    blockquote: `${base.blockquote}border-left-color:#4caf50;`
  },
  blue: {
    ...base,
    name: 'blue',
    h2: `${base.h2}color:#1e6bb8;border-bottom:2px solid #1e6bb8;padding-bottom:6px;`,
    h3: `${base.h3}color:#1e6bb8;`,
    a: 'color:#1e6bb8;text-decoration:none;',
    blockquote: `${base.blockquote}border-left-color:#1e6bb8;`
  }
}

function applyStyle(el: { getAttribute: (n: string) => string | undefined; setAttribute: (n: string, v: string) => void }, style: string): void {
  const existing = el.getAttribute('style')
  el.setAttribute('style', existing ? `${style}${existing}` : style)
}

/**
 * 将通用 HTML 转换为微信公众号友好的「内联样式」HTML。
 * 微信编辑器会剥离 class / 外部样式，因此必须内联。
 */
export function renderWechatHtml(html: string, themeName = 'default'): string {
  const theme = wechatThemes[themeName] ?? base
  const root = parse(html)

  const mapping: Array<[string, string]> = [
    ['h1', theme.h1],
    ['h2', theme.h2],
    ['h3', theme.h3],
    ['h4', theme.h4],
    ['h5', theme.h4],
    ['h6', theme.h4],
    ['p', theme.p],
    ['a', theme.a],
    ['ul', theme.ul],
    ['ol', theme.ol],
    ['li', theme.li],
    ['blockquote', theme.blockquote],
    ['pre', theme.pre],
    ['table', theme.table],
    ['th', theme.th],
    ['td', theme.td],
    ['hr', theme.hr],
    ['img', theme.img]
  ]

  for (const [tag, style] of mapping) {
    for (const el of root.querySelectorAll(tag)) {
      applyStyle(el, style)
    }
  }

  // 行内 code 与 pre 内的 code 区分处理
  for (const pre of root.querySelectorAll('pre')) {
    for (const code of pre.querySelectorAll('code')) {
      code.setAttribute('style', 'background:transparent;color:inherit;padding:0;font-size:13px;')
    }
  }
  for (const code of root.querySelectorAll('code')) {
    if (code.closest('pre')) continue
    applyStyle(code, theme.code)
  }

  return `<section style="${theme.container}">${root.toString()}</section>`
}

/** 提取 HTML 中所有图片地址（src） */
export function extractImageSrcs(html: string): string[] {
  const root = parse(html)
  const srcs = new Set<string>()
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (src) srcs.add(src)
  }
  return [...srcs]
}

/** 将 HTML 中的图片地址按映射替换 */
export function rewriteImageSrcs(html: string, mapping: Map<string, string>): string {
  const root = parse(html)
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (src && mapping.has(src)) img.setAttribute('src', mapping.get(src) as string)
  }
  return root.toString()
}

/**
 * 微信公众号正文会拒绝任何非微信域名的 <a> 链接（连 # 锚点也会触发
 * 「请勿插入非微信域名的链接」），因此除微信域名外全部降级为纯文本。
 */
export function stripLinksForWechat(html: string): string {
  const root = parse(html)
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? ''
    if (href.includes('weixin.qq.com')) continue
    a.replaceWith(...a.childNodes)
  }
  return root.toString()
}

/**
 * 移除仍指向非微信域名的图片（未成功上传到微信图床的图片），
 * 否则微信会拒绝并报「请勿插入非微信域名的链接」。
 */
export function dropExternalImages(html: string): { html: string; dropped: number } {
  const root = parse(html)
  let dropped = 0
  for (const img of root.querySelectorAll('img')) {
    img.removeAttribute('srcset')
    const src = img.getAttribute('src') ?? ''
    const uploaded =
      src.includes('mmbiz.qpic.cn') || src.includes('mmbiz.qlogo.cn') || src.startsWith('data:')
    if (!uploaded) {
      img.remove()
      dropped++
    }
  }
  return { html: root.toString(), dropped }
}
