import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { initDb, getSetting, setSetting } from '@main/db'
import { setWorkspace, readDoc } from '@main/fs/workspace'
import { getAdapter } from '@main/adapters'
import { toArticle } from '@main/markdown/render'
import type { PlatformId } from '@shared/types'

/** 用法：改 ROOT / DOC_ID / PUBLISH，然后 `npm run verify:publish` */
const ROOT = '/Users/chenjie/code/yuyuejia/datay/datay-web'
const DOC_ID = 'docs/电商场景-指标问数闭环指南.md'
const PUBLISH: PlatformId[] = (process.env.PUBLISH?.split(',').filter(Boolean) as PlatformId[]) ?? []

const log = (...a: unknown[]): void => console.log('[verify]', ...a)

app.whenReady().then(async () => {
  initDb()
  const previous = getSetting('workspace.root')
  try {
    await setWorkspace(ROOT)
    const doc = await readDoc(DOC_ID)
    const article = toArticle(doc, join(ROOT, doc.dir))
    log('TITLE:', article.title)

    for (const id of ['wechat', 'juejin', 'zhihu', 'toutiao', 'oschina'] as PlatformId[]) {
      const adapter = getAdapter(id)
      const auth = await adapter.checkAuth()
      log(`AUTH ${id}:`, JSON.stringify(auth))
      if (auth.isAuthenticated && PUBLISH.includes(id)) {
        try {
          const result = await adapter.publish(article, { draftOnly: true })
          log(`RESULT ${id}:`, JSON.stringify(result, null, 2))
        } catch (e) {
          log(`ERROR ${id}:`, (e as Error).message)
        }
      }
    }
    void existsSync
  } catch (e) {
    log('FATAL:', (e as Error).message)
  } finally {
    setSetting('workspace.root', previous ?? '')
    app.quit()
  }
})
