import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { EVT, IPC, type PublishInput } from '@shared/ipc'
import type { CreateDocInput, PlatformId, RenameDocInput, SaveDocInput } from '@shared/types'
import {
  createDoc,
  deleteDoc,
  getWorkspaceRoot,
  listDocs,
  loadWorkspace,
  readDoc,
  renameDoc,
  reindex,
  resolveForReveal,
  saveDoc,
  setWorkspace
} from '@main/fs/workspace'
import { startWatcher, stopWatcher, type FsChange } from '@main/fs/watcher'
import {
  listPlatforms,
  checkAuth,
  loginPlatform,
  logoutPlatform,
  publish as publishTo,
  listRecords
} from '@main/publish'

let mainWindow: BrowserWindow | null = null

function emit(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function onFsChange(change: FsChange): void {
  emit(EVT.docChanged, change)
}

export function registerIpc(window: BrowserWindow): void {
  mainWindow = window

  ipcMain.handle(IPC.appPing, () => 'pong')

  ipcMain.handle(IPC.workspaceGet, () => {
    const root = getWorkspaceRoot() ?? loadWorkspace()
    return { root }
  })

  ipcMain.handle(IPC.workspaceChoose, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择 Markdown 工作区',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { root: getWorkspaceRoot() }
    await setWorkspace(result.filePaths[0])
    startWatcher(onFsChange)
    return { root: getWorkspaceRoot() }
  })

  ipcMain.handle(IPC.workspaceOpen, async (_e, root: string) => {
    await setWorkspace(root)
    startWatcher(onFsChange)
    return { root: getWorkspaceRoot() }
  })

  ipcMain.handle(IPC.docList, () => {
    if (!getWorkspaceRoot()) loadWorkspace()
    if (!getWorkspaceRoot()) return []
    // 读取已建索引，避免每次列举都全量遍历/解析工作区
    return listDocs()
  })

  ipcMain.handle(IPC.docRead, (_e, id: string) => readDoc(id))

  ipcMain.handle(IPC.docCreate, (_e, input: CreateDocInput) => createDoc(input ?? {}))

  ipcMain.handle(IPC.docSave, (_e, input: SaveDocInput) => saveDoc(input.id, input.raw))

  ipcMain.handle(IPC.docRename, (_e, input: RenameDocInput) => renameDoc(input))

  ipcMain.handle(IPC.docDelete, async (_e, id: string) => {
    await deleteDoc(id)
  })

  ipcMain.handle(IPC.docReveal, (_e, id: string) => {
    shell.showItemInFolder(resolveForReveal(id))
  })

  // ---- 发布 ----
  ipcMain.handle(IPC.platformList, () => listPlatforms())
  ipcMain.handle(IPC.platformCheckAuth, (_e, id: PlatformId) => checkAuth(id))
  ipcMain.handle(IPC.platformLogin, (_e, id: PlatformId) => loginPlatform(window, id))
  ipcMain.handle(IPC.platformLogout, (_e, id: PlatformId) => logoutPlatform(id))
  ipcMain.handle(IPC.platformPublish, (_e, input: PublishInput) =>
    publishTo(input, (progress) => emit(EVT.publishProgress, progress))
  )
  ipcMain.handle(IPC.recordList, (_e, docId?: string) => listRecords(docId))

  // 启动时建立索引并监听文件变化（在窗口就绪后再做，避免阻塞首屏）
  if (getWorkspaceRoot()) {
    setTimeout(() => {
      void reindex().then(() => {
        startWatcher(onFsChange)
        emit(EVT.docChanged, { type: 'update', id: '' })
      })
    }, 0)
  }

  window.on('closed', () => {
    stopWatcher()
    mainWindow = null
  })
}

export function disposeIpc(): void {
  stopWatcher()
}
