import { watch, type FSWatcher } from 'node:fs'
import { join, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { indexSingle, removeFromIndex, toRel, requireRoot } from './workspace'

export interface FsChange {
  type: 'update' | 'delete'
  id: string
}

let watcher: FSWatcher | null = null
const pending = new Map<string, NodeJS.Timeout>()

function schedule(abs: string, onChange: (c: FsChange) => void, delay = 250): void {
  const existing = pending.get(abs)
  if (existing) clearTimeout(existing)
  pending.set(
    abs,
    setTimeout(() => {
      pending.delete(abs)
      try {
        const rel = toRel(abs)
        if (existsSync(abs)) {
          indexSingle(abs)
          onChange({ type: 'update', id: rel })
        } else {
          removeFromIndex(abs)
          onChange({ type: 'delete', id: rel })
        }
      } catch {
        // 忽略索引过程中的瞬时错误（文件正在写入）
      }
    }, delay)
  )
}

export function startWatcher(onChange: (c: FsChange) => void): void {
  stopWatcher()
  if (!requireRoot()) return
  const root = requireRoot()
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const name = String(filename)
      if (extname(name).toLowerCase() !== '.md') return
      schedule(join(root, name), onChange)
    })
    watcher.on('error', () => {
      /* 忽略 watch 错误 */
    })
  } catch {
    // 某些平台不支持 recursive；降级为仅监听根目录
    try {
      watcher = watch(root, (_event, filename) => {
        if (!filename) return
        const name = String(filename)
        if (extname(name).toLowerCase() !== '.md') return
        schedule(join(root, name), onChange)
      })
    } catch {
      watcher = null
    }
  }
}

export function stopWatcher(): void {
  for (const t of pending.values()) clearTimeout(t)
  pending.clear()
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
