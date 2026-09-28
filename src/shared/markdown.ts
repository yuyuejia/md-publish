import MarkdownIt, { type MarkdownIt as MarkdownItType } from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import nginx from 'highlight.js/lib/languages/nginx'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const languages: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  shell,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  markdown,
  nginx,
  php,
  plaintext,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml
}

for (const [name, lang] of Object.entries(languages)) {
  hljs.registerLanguage(name, lang)
}
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' })
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' })

function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const value = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      return `<pre class="hljs"><code class="language-${lang}">${value}</code></pre>`
    } catch {
      /* fallthrough */
    }
  }
  return ''
}

let instance: MarkdownItType | null = null

export function createMarkdown(): MarkdownItType {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    highlight
  })
  md.use(anchor, { permalink: anchor.permalink.headerLink() })
  md.use(taskLists, { enabled: true, label: true })
  md.use(footnote)
  return md
}

export function getMarkdown(): MarkdownItType {
  if (!instance) instance = createMarkdown()
  return instance
}

export function renderMarkdown(src: string): string {
  return getMarkdown().render(src)
}

/** 为块级元素注入 data-line，用于预览与编辑器滚动同步 */
function withLineNumbers(md: MarkdownItType): void {
  const original = md.renderer.renderToken.bind(md.renderer)
  md.renderer.renderToken = (tokens, idx, options) => {
    const token = tokens[idx]
    if (token.map && token.nesting !== -1) {
      token.attrSet('data-line', String(token.map[0]))
    }
    return original(tokens, idx, options)
  }
  for (const name of ['fence', 'code_block']) {
    const rule = md.renderer.rules[name]
    if (!rule) continue
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const out = rule(tokens, idx, options, env, self)
      const line = tokens[idx].map?.[0]
      return line == null ? out : out.replace('<pre', `<pre data-line="${line}"`)
    }
  }
}

let previewInstance: MarkdownItType | null = null

function getPreviewMarkdown(): MarkdownItType {
  if (!previewInstance) {
    previewInstance = createMarkdown()
    withLineNumbers(previewInstance)
  }
  return previewInstance
}

/** 预览专用：输出带 data-line 的 HTML，便于滚动同步 */
export function renderMarkdownPreview(src: string): string {
  return getPreviewMarkdown().render(src)
}
