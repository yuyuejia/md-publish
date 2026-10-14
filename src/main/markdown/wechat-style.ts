import { NodeType, parse, type HTMLElement, type Node, type TextNode } from 'node-html-parser'

/**
 * 默认情况下 node-html-parser 会把 <pre> 当作「块级文本元素」，
 * 其内部（含 highlight.js 的 <span>）不会被解析成 DOM，导致无法处理代码块。
 * 这里排除 pre，让代码块内部正常解析。
 */
const PARSE_OPTIONS = { blockTextElements: { script: true, noscript: true, style: true } }

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
  pre: 'margin:16px 0;padding:14px 16px;background:#282c34;border-radius:6px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;color:#abb2bf;',
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
 * 微信公众号编辑器会压缩代码块中的空白符，直接依赖 <pre> 的默认样式会导致缩进/换行丢失，
 * 粘贴后必须手动重新排版。这里把换行显式转为 <br/>、行首缩进与连续的多个空格转为 &nbsp;，
 * 从而在微信中（即使 <pre> 被剥离或 white-space 被重置）仍能保持代码排版。
 */
function escapeCodeText(raw: string, state: { lineStart: boolean }): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      out += '<br/>'
      state.lineStart = true
      i++
      continue
    }
    if (ch === '\t') {
      out += '&nbsp;&nbsp;&nbsp;&nbsp;'
      i++
      continue
    }
    if (ch === ' ') {
      let j = i
      while (j < raw.length && raw[j] === ' ') j++
      const run = j - i
      // 行首缩进或连续空格需要保留；行内的单个空格保留为普通空格以便自动折行
      out += state.lineStart || run >= 2 ? '&nbsp;'.repeat(run) : ' '
      i = j
      continue
    }
    out += ch
    state.lineStart = false
    i++
  }
  return out
}

function findLastTextNode(node: Node): TextNode | null {
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i]
    if (child.nodeType === NodeType.TEXT_NODE) return child as TextNode
    const found = findLastTextNode(child)
    if (found) return found
  }
  return null
}

function preserveCodeWhitespace(pre: HTMLElement): void {
  const state = { lineStart: true }
  const walk = (node: Node): void => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const text = node as TextNode
      text.rawText = escapeCodeText(text.rawText, state)
      return
    }
    const el = node as HTMLElement
    if (el.rawTagName === 'br') {
      state.lineStart = true
      return
    }
    for (const child of el.childNodes) walk(child)
  }
  for (const child of pre.childNodes) walk(child)
  // highlight.js 会在结尾补一个换行，去掉它避免代码块底部多出一个空行
  const last = findLastTextNode(pre)
  if (last && last.rawText.endsWith('<br/>')) last.rawText = last.rawText.slice(0, -5)
}

function isWhitespaceText(node: Node): boolean {
  return node.nodeType === NodeType.TEXT_NODE && (node as TextNode).rawText.trim() === ''
}

/**
 * 微信编辑器会给列表项包裹/保留段落，松列表（项间有空行）会被 markdown-it 渲染成
 * `<li><p style="margin:14px 0">…</p></li>`，上传后每项之间就多出空行。
 * 这里把单项列表项内的 <p> 拆掉、多项的去掉段落外边距，并清理列表中的空白文本节点。
 */
function normalizeLists(root: HTMLElement): void {
  for (const li of root.querySelectorAll('li')) {
    const paragraphs = li.childNodes.filter(
      (n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE && (n as HTMLElement).rawTagName === 'p'
    )
    if (paragraphs.length === 1) {
      const p = paragraphs[0]
      p.replaceWith(...p.childNodes)
    } else {
      for (const p of paragraphs) {
        const style = p.getAttribute('style') ?? ''
        p.setAttribute('style', style.replace(/margin:[^;]*;?/g, ''))
      }
    }
    if (paragraphs.length > 0) {
      for (const child of [...li.childNodes]) {
        if (isWhitespaceText(child)) child.remove()
      }
    }
  }
  for (const list of root.querySelectorAll('ol, ul')) {
    for (const child of [...list.childNodes]) {
      if (isWhitespaceText(child)) child.remove()
    }
  }
}

/**
 * 将通用 HTML 转换为微信公众号友好的「内联样式」HTML。
 * 微信编辑器会剥离 class / 外部样式，因此必须内联。
 */
export function renderWechatHtml(html: string, themeName = 'default'): string {
  const theme = wechatThemes[themeName] ?? base
  const root = parse(html, PARSE_OPTIONS)

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
    preserveCodeWhitespace(pre)
  }
  for (const code of root.querySelectorAll('code')) {
    if (code.closest('pre')) continue
    applyStyle(code, theme.code)
  }

  normalizeLists(root)

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
