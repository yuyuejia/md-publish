// 运行发布验证脚本：先打包 scripts/verify-publish.ts，再用 Electron 执行。
// 用法：PUBLISH=juejin,zhihu npm run verify:publish
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

mkdirSync('.verify', { recursive: true })
writeFileSync(
  '.verify/package.json',
  JSON.stringify({ name: 'md-publish', version: '0.1.0', main: 'verify.cjs' }, null, 2)
)

execFileSync(
  'npx',
  [
    'esbuild',
    'scripts/verify-publish.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=.verify/verify.cjs',
    '--alias:@main=./src/main',
    '--alias:@shared=./src/shared',
    '--external:electron',
    '--external:better-sqlite3',
    '--log-level=warning'
  ],
  { stdio: 'inherit' }
)

execFileSync('npx', ['electron', '.verify'], { stdio: 'inherit' })
