const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function isAbsolute(src: string): boolean {
  return src.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(src)
}

/** 宽容地解码 URL 编码路径（Markdown 中空格常写作 %20） */
function safeDecode(src: string): string {
  if (!src.includes('%')) return src
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** 归一化 POSIX 路径，处理 . 与 ..，保留前导 / */
function normalize(path: string): string {
  const parts = path.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' && out.length === 0) {
      out.push('')
      continue
    }
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 1) out.pop()
      else if (out.length === 1 && out[0] !== '') out.pop()
      continue
    }
    out.push(part)
  }
  if (out.length === 0) return '/'
  return out.join('/')
}

/** 将绝对路径转为自定义协议 URL：mdp://local/<绝对路径> */
export function toAssetUrl(absPosix: string): string {
  let p = absPosix
  if (/^[a-zA-Z]:\//.test(p)) p = `/${p}`
  else if (!p.startsWith('/')) p = `/${p}`
  const encoded = p.split('/').map(encodeURIComponent).join('/')
  return `mdp://local${encoded}`
}

/**
 * 将 Markdown 中的图片地址解析为可预览的 URL。
 * 相对路径按「文档所在目录」解析，而非工作目录。
 */
export function resolveImageSrc(
  src: string,
  baseDir: string | null,
  root: string | null
): string {
  if (!src) return src

  // 绝对路径优先判断（避免 Windows 盘符 C:\ 被误判为 URL scheme）
  if (isAbsolute(src)) return toAssetUrl(normalize(toPosix(safeDecode(src))))

  if (SCHEME_RE.test(src)) {
    if (src.startsWith('file:')) {
      try {
        return toAssetUrl(toPosix(decodeURIComponent(new URL(src).pathname)))
      } catch {
        return src
      }
    }
    return src
  }

  const base = baseDir ? toPosix(baseDir) : root ? toPosix(root) : ''
  if (!base) return src
  return toAssetUrl(normalize(`${base}/${toPosix(safeDecode(src))}`))
}
