import type { PlatformId } from '@shared/types'
import type { CookieAdapter } from './base'
import { WechatAdapter } from './wechat'
import { JuejinAdapter } from './juejin'
import { ZhihuAdapter } from './zhihu'
import { ToutiaoAdapter } from './toutiao'
import { OschinaAdapter } from './oschina'

const adapters: CookieAdapter[] = [
  new WechatAdapter(),
  new JuejinAdapter(),
  new ZhihuAdapter(),
  new ToutiaoAdapter(),
  new OschinaAdapter()
]
const registry = new Map<string, CookieAdapter>(adapters.map((a) => [a.meta.id, a]))

export function allAdapters(): CookieAdapter[] {
  return adapters
}

export function getAdapter(id: PlatformId): CookieAdapter {
  const adapter = registry.get(id)
  if (!adapter) throw new Error(`未知平台: ${id}`)
  return adapter
}
