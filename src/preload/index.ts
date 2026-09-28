import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PublishInput, type RendererApi } from '@shared/ipc'
import type { CreateDocInput, PlatformId, RenameDocInput, SaveDocInput } from '@shared/types'

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>

const api: RendererApi = {
  ping: () => invoke<string>(IPC.appPing),
  workspace: {
    get: () => invoke(IPC.workspaceGet),
    choose: () => invoke(IPC.workspaceChoose),
    open: (root: string) => invoke(IPC.workspaceOpen, root)
  },
  docs: {
    list: () => invoke(IPC.docList),
    read: (id: string) => invoke(IPC.docRead, id),
    create: (input: CreateDocInput) => invoke(IPC.docCreate, input),
    save: (input: SaveDocInput) => invoke(IPC.docSave, input),
    rename: (input: RenameDocInput) => invoke(IPC.docRename, input),
    remove: (id: string) => invoke(IPC.docDelete, id),
    reveal: (id: string) => invoke(IPC.docReveal, id)
  },
  platforms: {
    list: () => invoke(IPC.platformList),
    checkAuth: (id: PlatformId) => invoke(IPC.platformCheckAuth, id),
    login: (id: PlatformId) => invoke(IPC.platformLogin, id),
    logout: (id: PlatformId) => invoke(IPC.platformLogout, id),
    publish: (input: PublishInput) => invoke(IPC.platformPublish, input)
  },
  records: {
    list: (docId?: string) => invoke(IPC.recordList, docId)
  },
  on: (channel: string, listener: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
