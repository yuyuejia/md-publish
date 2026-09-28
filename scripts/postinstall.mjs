// 处理 npm 较新版本默认拦截第三方 install 脚本的问题：
// 确保 electron 二进制已下载，并重建原生依赖以适配 Electron ABI。
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function ensureElectron() {
  try {
    const electronPath = require('electron')
    if (typeof electronPath === 'string' && existsSync(electronPath)) {
      console.log('[postinstall] electron binary ready')
      return
    }
    throw new Error('electron binary missing')
  } catch {
    console.log('[postinstall] downloading electron binary...')
    execSync('node node_modules/electron/install.js', { stdio: 'inherit' })
  }
}

function rebuildNative() {
  try {
    execSync('npx electron-builder install-app-deps', { stdio: 'inherit' })
  } catch (e) {
    console.warn('[postinstall] install-app-deps skipped:', e.message)
  }
}

ensureElectron()
rebuildNative()
