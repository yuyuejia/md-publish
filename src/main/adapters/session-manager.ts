import { app, BrowserWindow, session, type Session } from 'electron'
import type { AuthResult } from '@shared/types'

const cache = new Map<string, Session>()

export function partitionFor(platformId: string): string {
  return `persist:mdpublish-${platformId}`
}

export function getPlatformSession(platformId: string): Session {
  const key = partitionFor(platformId)
  const cached = cache.get(key)
  if (cached) return cached
  const s = session.fromPartition(key)
  cache.set(key, s)
  return s
}

export async function clearPlatformSession(platformId: string): Promise<void> {
  const s = getPlatformSession(platformId)
  await s.clearStorageData({ storages: ['cookies', 'localstorage'] })
}

export interface LoginWindowOptions {
  platformId: string
  title: string
  loginUrl: string
  /** 判断是否已登录；返回 isAuthenticated=true 即关闭登录窗 */
  probe: (s: Session) => Promise<AuthResult>
  /** 登录成功后可选的落地校验 URL */
  successUrl?: string
}

/**
 * 打开一个携带独立 partition 的登录窗口，轮询 probe 判断登录完成。
 * 用户关闭窗口时以最后一次探测结果返回。
 */
export async function openLoginWindow(
  parent: BrowserWindow | null,
  opts: LoginWindowOptions
): Promise<AuthResult> {
  const s = getPlatformSession(opts.platformId)
  const win = new BrowserWindow({
    width: 1024,
    height: 760,
    parent: parent ?? undefined,
    modal: false,
    title: opts.title,
    autoHideMenuBar: true,
    webPreferences: {
      partition: partitionFor(opts.platformId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  await win.loadURL(opts.loginUrl)

  // 登录窗口关闭后，把焦点还给主窗口（否则系统会切到其它 App）
  const focusMain = (): void => {
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore()
      if (!parent.isVisible()) parent.show()
      parent.focus()
    }
    if (process.platform === 'darwin') app.focus({ steal: true })
  }

  return new Promise<AuthResult>((resolve) => {
    let settled = false
    let last: AuthResult = { isAuthenticated: false }

    const finish = (result: AuthResult): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }

    const probeOnce = async (): Promise<void> => {
      try {
        last = await opts.probe(s)
        if (last.isAuthenticated) {
          if (opts.successUrl) {
            try {
              await win.loadURL(opts.successUrl)
            } catch {
              /* ignore */
            }
          }
          finish(last)
        }
      } catch {
        // 探测失败继续等待
      }
    }

    const timer = setInterval(() => void probeOnce(), 1500)
    void probeOnce()

    win.on('closed', () => {
      if (!settled) {
        settled = true
        clearInterval(timer)
        resolve(last)
      }
      focusMain()
    })
  })
}
