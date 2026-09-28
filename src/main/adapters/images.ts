import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { Session } from 'electron'

export interface LoadedImage {
  blob: Blob
  filename: string
  contentType: string
}

function guessType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return 'image/png'
}

/** Markdown 会把中文/空格路径百分号编码，读文件前需还原 */
function safeDecode(input: string): string {
  if (!input.includes('%')) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

/** 从远程 URL / 本地路径 / data URI 读取图片为 Blob */
export async function loadImage(
  input: string,
  session: Session,
  baseDir?: string
): Promise<LoadedImage> {
  if (/^https?:\/\//i.test(input)) {
    const res = await session.fetch(input)
    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') ?? guessType(input)
    let filename = 'image.png'
    try {
      filename = basename(new URL(input).pathname) || filename
    } catch {
      /* ignore */
    }
    return { blob: new Blob([new Uint8Array(buf)], { type: contentType }), filename, contentType }
  }

  if (/^data:/i.test(input)) {
    const match = input.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new Error('无法解析 data URI 图片')
    const contentType = match[1]
    const buf = Buffer.from(match[2], 'base64')
    return {
      blob: new Blob([new Uint8Array(buf)], { type: contentType }),
      filename: 'image.png',
      contentType
    }
  }

  let path = safeDecode(input)
  if (input.startsWith('file://')) {
    path = decodeURIComponent(new URL(input).pathname)
  } else if (!path.startsWith('/') && baseDir) {
    path = `${baseDir}/${path}`
  }
  const buf = await fs.readFile(path)
  const contentType = guessType(path)
  return { blob: new Blob([new Uint8Array(buf)], { type: contentType }), filename: basename(path), contentType }
}
