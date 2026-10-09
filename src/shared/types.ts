export type PlatformId = 'wechat' | 'juejin' | 'zhihu' | 'toutiao' | 'oschina'

export interface PlatformMeta {
  id: PlatformId
  name: string
  homepage: string
  /** v1 全部为 cookie 登录；保留 token 以便将来扩展（博客园/语雀/WordPress） */
  authType: 'cookie' | 'token'
  capabilities: Array<'article' | 'draft' | 'image_upload'>
}

export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  avatar?: string
  error?: string
}

export interface Article {
  title: string
  markdown: string
  html: string
  cover?: string
  summary?: string
  tags?: string[]
  sourceUrl?: string
  /** 文档所在目录（绝对路径），用于解析相对路径图片 */
  baseDir?: string
}

export interface PublishOptions {
  /** 仅保存草稿（默认 true） */
  draftOnly?: boolean
  tags?: string[]
  category?: string
  column?: string
  original?: boolean
  cover?: string
  summary?: string
}

export interface SyncResult {
  platform: PlatformId
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  warning?: string
  timestamp: number
}

export type PublishStatus = 'pending' | 'success' | 'failed'

export interface PublishRecord {
  id: number
  docId: string
  platform: PlatformId
  status: PublishStatus
  postId?: string
  postUrl?: string
  draftOnly: boolean
  error?: string
  createdAt: number
}

/** 文档在 SQLite 中的索引记录；正文始终以 .md 文件为准 */
export interface DocumentMeta {
  id: string
  title: string
  dir: string
  mtime: number
  size: number
  tags: string[]
  summary?: string
  cover?: string
  frontMatter: Record<string, unknown>
}

export interface DocumentContent extends DocumentMeta {
  /** 包含 front-matter 的完整原始文本 */
  raw: string
  /** 去除 front-matter 的正文 */
  body: string
}

export interface WorkspaceInfo {
  root: string | null
}

export interface CreateDocInput {
  dir?: string
  title?: string
}

export interface SaveDocInput {
  id: string
  raw: string
}

export interface RenameDocInput {
  id: string
  title: string
}
