import type { BrowserWindow, Session } from 'electron'
import type { Article, AuthResult, PlatformMeta, PublishOptions, SyncResult } from '@shared/types'
import { getPlatformSession, openLoginWindow } from './session-manager'

export interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit | null
  json?: unknown
}

export abstract class CookieAdapter {
  abstract readonly meta: PlatformMeta
  /** 登录页地址 */
  protected abstract readonly loginUrl: string

  private headersInstalled = false

  get session(): Session {
    return getPlatformSession(this.meta.id)
  }

  /**
   * 给本平台 session 注入请求头（Electron 的 fetch 无法直接设置 Origin/Referer）。
   * 每个 session 只能安装一个 onBeforeSendHeaders 监听，故只安装一次。
   */
  protected installHeaderRules(
    rules: Array<{ test: RegExp; headers: Record<string, string> }>
  ): void {
    if (this.headersInstalled) return
    this.headersInstalled = true
    this.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = details.requestHeaders
      for (const rule of rules) {
        if (rule.test.test(details.url)) Object.assign(headers, rule.headers)
      }
      callback({ requestHeaders: headers })
    })
  }

  /** 通过 platform 自己的登录态探测是否已登录 */
  protected abstract probe(session: Session): Promise<AuthResult>

  async checkAuth(): Promise<AuthResult> {
    try {
      return await this.probe(this.session)
    } catch (e) {
      return { isAuthenticated: false, error: (e as Error).message }
    }
  }

  async login(parent: BrowserWindow | null): Promise<AuthResult> {
    return openLoginWindow(parent, {
      platformId: this.meta.id,
      title: `登录 ${this.meta.name}`,
      loginUrl: this.loginUrl,
      probe: (s) => this.probe(s)
    })
  }

  abstract publish(article: Article, options: PublishOptions): Promise<SyncResult>

  async uploadImage(_input: string): Promise<{ url: string }> {
    throw new Error(`${this.meta.name} 暂不支持图片上传`)
  }

  /** 清除适配器内存中的登录态缓存（重置登录时调用） */
  reset(): void {
    // 默认无缓存
  }

  /** 使用平台独立 session 发起请求（自动携带 Cookie） */
  protected async request(url: string, options: FetchOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    let body = options.body ?? null
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    }
    return this.session.fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: body as BodyInit | null
    })
  }

  protected result(partial: Omit<SyncResult, 'platform' | 'timestamp'>): SyncResult {
    return { platform: this.meta.id, timestamp: Date.now(), ...partial }
  }
}
