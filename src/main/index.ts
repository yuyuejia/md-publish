import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb } from './db'
import { registerIpc, disposeIpc } from './ipc'
import { loadWorkspace } from './fs/workspace'
import { registerAssetProtocol, registerAssetScheme } from './assets'
import { stopWorkspaceAccess } from './mac/bookmark'

app.setName('md-publish')

registerAssetScheme()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    title: 'md-publish',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mdpublish.app')

  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDb()
  registerAssetProtocol()
  loadWorkspace()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  disposeIpc()
  app.quit()
})

app.on('will-quit', () => {
  stopWorkspaceAccess()
})
