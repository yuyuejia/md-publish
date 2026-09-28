import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'

interface BookmarkResolution {
  path: string
  stale: boolean
  started: boolean
  bookmark?: Buffer
}

interface BookmarkAddon {
  createBookmark(path: string): Buffer
  startAccessing(bookmark: Buffer): BookmarkResolution
  stopAccessing(path: string): boolean
  stopAll(): boolean
}

const nodeRequire = createRequire(__filename)

let addon: BookmarkAddon | null = null
let loaded = false
let activePath: string | null = null

/**
 * macOS App Sandbox 下，通过「选择文件夹」拿到的权限重启后失效，
 * 需要 security-scoped bookmark 才能持续访问工作区。
 * 非 macOS 或原生模块缺失时返回 null（降级为普通路径访问）。
 */
function loadAddon(): BookmarkAddon | null {
  if (loaded) return addon
  loaded = true
  if (process.platform !== 'darwin') return null
  const relative = join('native', 'mac-bookmark', 'build', 'Release', 'mac-bookmark.node')
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'mac-bookmark', 'mac-bookmark.node')]
    : [join(app.getAppPath(), relative), join(process.cwd(), relative)]
  for (const file of candidates) {
    try {
      addon = nodeRequire(file) as BookmarkAddon
      break
    } catch {
      /* try next */
    }
  }
  return addon
}

export function isBookmarkSupported(): boolean {
  return loadAddon() !== null
}

/** 为工作区目录创建 security-scoped bookmark，返回 base64（不支持时 null） */
export function createWorkspaceBookmark(dir: string): string | null {
  const a = loadAddon()
  if (!a) return null
  try {
    const buf = a.createBookmark(dir)
    activePath = dir
    return buf.toString('base64')
  } catch {
    return null
  }
}

/** 由 bookmark 恢复安全作用域访问 */
export function startWorkspaceAccess(
  base64: string
): { path: string; stale: boolean; bookmark?: string } | null {
  const a = loadAddon()
  if (!a) return null
  try {
    const r = a.startAccessing(Buffer.from(base64, 'base64'))
    activePath = r.path
    return {
      path: r.path,
      stale: r.stale,
      bookmark: r.bookmark ? r.bookmark.toString('base64') : undefined
    }
  } catch {
    return null
  }
}

export function stopWorkspaceAccess(): void {
  const a = loadAddon()
  if (!a) return
  if (activePath) a.stopAccessing(activePath)
  a.stopAll()
  activePath = null
}
