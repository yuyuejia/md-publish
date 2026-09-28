import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

export const ASSET_SCHEME = 'mdp'

/** 必须在 app ready 之前调用 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** 处理 mdp://local/<绝对路径>，用于在渲染进程预览本地图片 */
export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      let p = decodeURIComponent(url.pathname)
      // Windows 盘符: /C:/Users/... -> C:/Users/...
      if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
      if (!p) return new Response('Not found', { status: 404 })
      return await net.fetch(pathToFileURL(p).toString())
    } catch (e) {
      return new Response(`Bad request: ${(e as Error).message}`, { status: 400 })
    }
  })
}
