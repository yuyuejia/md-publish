import type {
  AuthResult,
  CreateDocInput,
  DocumentContent,
  DocumentMeta,
  PlatformId,
  PlatformMeta,
  PublishOptions,
  PublishRecord,
  RenameDocInput,
  SaveDocInput,
  SyncResult,
  WorkspaceInfo
} from './types'

export const IPC = {
  appPing: 'app:ping',
  workspaceGet: 'workspace:get',
  workspaceChoose: 'workspace:choose',
  workspaceOpen: 'workspace:open',
  docList: 'doc:list',
  docRead: 'doc:read',
  docCreate: 'doc:create',
  docSave: 'doc:save',
  docRename: 'doc:rename',
  docDelete: 'doc:delete',
  docReveal: 'doc:reveal',
  platformList: 'platform:list',
  platformCheckAuth: 'platform:check-auth',
  platformLogin: 'platform:login',
  platformLogout: 'platform:logout',
  platformPublish: 'platform:publish',
  recordList: 'record:list'
} as const

export const EVT = {
  workspaceChanged: 'evt:workspace-changed',
  docChanged: 'evt:doc-changed',
  publishProgress: 'evt:publish-progress'
} as const

export interface PublishInput {
  docId: string
  platforms: PlatformId[]
  options?: PublishOptions
}

export interface PublishProgress {
  docId: string
  platform: PlatformId
  phase: 'auth' | 'transform' | 'upload' | 'submit' | 'done'
  message?: string
}

/** 由 preload 暴露到 window.api 的完整接口契约 */
export interface RendererApi {
  ping(): Promise<string>
  workspace: {
    get(): Promise<WorkspaceInfo>
    choose(): Promise<WorkspaceInfo>
    open(root: string): Promise<WorkspaceInfo>
  }
  docs: {
    list(): Promise<DocumentMeta[]>
    read(id: string): Promise<DocumentContent>
    create(input: CreateDocInput): Promise<DocumentMeta>
    save(input: SaveDocInput): Promise<DocumentMeta>
    rename(input: RenameDocInput): Promise<DocumentMeta>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
  }
  platforms: {
    list(): Promise<PlatformMeta[]>
    checkAuth(id: PlatformId): Promise<AuthResult>
    login(id: PlatformId): Promise<AuthResult>
    logout(id: PlatformId): Promise<void>
    publish(input: PublishInput): Promise<SyncResult[]>
  }
  records: {
    list(docId?: string): Promise<PublishRecord[]>
  }
  on(channel: string, listener: (payload: unknown) => void): () => void
}
