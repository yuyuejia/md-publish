import type { BrowserWindow } from 'electron'
import type { PublishInput, PublishProgress } from '@shared/ipc'
import type {
  AuthResult,
  PlatformId,
  PlatformMeta,
  PublishRecord,
  SyncResult
} from '@shared/types'
import { allAdapters, getAdapter } from './adapters'
import { clearPlatformSession } from './adapters/session-manager'
import { getDb } from './db'
import { getWorkspaceRoot, readDoc } from './fs/workspace'
import { toArticle } from './markdown/render'
import { join } from 'node:path'

export function listPlatforms(): PlatformMeta[] {
  return allAdapters().map((a) => a.meta)
}

export function checkAuth(id: PlatformId): Promise<AuthResult> {
  return getAdapter(id).checkAuth()
}

export function loginPlatform(parent: BrowserWindow | null, id: PlatformId): Promise<AuthResult> {
  return getAdapter(id).login(parent)
}

/** 重置登录：清除该平台 session 的 Cookie/存储，并清空适配器内存缓存 */
export async function logoutPlatform(id: PlatformId): Promise<void> {
  await clearPlatformSession(id)
  getAdapter(id).reset()
}

function saveRecord(record: Omit<PublishRecord, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO publish_records(doc_id, platform, status, post_id, post_url, draft_only, error, created_at)
       VALUES(@docId, @platform, @status, @postId, @postUrl, @draftOnly, @error, @createdAt)`
    )
    .run({
      docId: record.docId,
      platform: record.platform,
      status: record.status,
      postId: record.postId ?? null,
      postUrl: record.postUrl ?? null,
      draftOnly: record.draftOnly ? 1 : 0,
      error: record.error ?? null,
      createdAt: record.createdAt
    })
}

export async function publish(
  input: PublishInput,
  onProgress: (p: PublishProgress) => void
): Promise<SyncResult[]> {
  const doc = await readDoc(input.docId)
  const root = getWorkspaceRoot()
  const baseDir = root ? join(root, doc.dir) : undefined
  const article = toArticle(doc, baseDir)
  const options = input.options ?? {}
  const results: SyncResult[] = []

  for (const platform of input.platforms) {
    try {
      onProgress({ docId: doc.id, platform, phase: 'auth' })
      const adapter = getAdapter(platform)
      const auth = await adapter.checkAuth()
      if (!auth.isAuthenticated) {
        throw new Error('未登录或登录已失效')
      }

      onProgress({ docId: doc.id, platform, phase: 'submit' })
      const result = await adapter.publish(article, options)
      results.push(result)

      saveRecord({
        docId: doc.id,
        platform,
        status: result.success ? 'success' : 'failed',
        postId: result.postId,
        postUrl: result.postUrl,
        draftOnly: result.draftOnly ?? true,
        error: result.error,
        createdAt: result.timestamp
      })
    } catch (e) {
      const result: SyncResult = {
        platform,
        success: false,
        error: (e as Error).message,
        timestamp: Date.now()
      }
      results.push(result)
      saveRecord({
        docId: doc.id,
        platform,
        status: 'failed',
        draftOnly: true,
        error: result.error,
        createdAt: result.timestamp
      })
    } finally {
      onProgress({ docId: doc.id, platform, phase: 'done' })
    }
  }

  return results
}

export function listRecords(docId?: string): PublishRecord[] {
  const rows = docId
    ? (getDb()
        .prepare('SELECT * FROM publish_records WHERE doc_id = ? ORDER BY created_at DESC')
        .all(docId) as RawRecord[])
    : (getDb()
        .prepare('SELECT * FROM publish_records ORDER BY created_at DESC LIMIT 200')
        .all() as RawRecord[])
  return rows.map((r) => ({
    id: r.id,
    docId: r.doc_id,
    platform: r.platform as PlatformId,
    status: r.status as PublishRecord['status'],
    postId: r.post_id ?? undefined,
    postUrl: r.post_url ?? undefined,
    draftOnly: !!r.draft_only,
    error: r.error ?? undefined,
    createdAt: r.created_at
  }))
}

interface RawRecord {
  id: number
  doc_id: string
  platform: string
  status: string
  post_id: string | null
  post_url: string | null
  draft_only: number
  error: string | null
  created_at: number
}
