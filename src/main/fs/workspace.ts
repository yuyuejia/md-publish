import { promises as fs } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep, basename, dirname, extname } from 'node:path'
import matter from 'gray-matter'
import type { CreateDocInput, DocumentContent, DocumentMeta, RenameDocInput } from '@shared/types'
import { getDb, getSetting, setSetting } from '@main/db'
import {
  createWorkspaceBookmark,
  startWorkspaceAccess
} from '@main/mac/bookmark'

const SETTING_KEY = 'workspace.root'
const BOOKMARK_KEY = 'workspace.bookmark'
const IGNORED_DIRS = new Set(['node_modules', '.git', '.obsidian', 'dist', 'out', '.cache'])

let root: string | null = null

export function getWorkspaceRoot(): string | null {
  return root
}

export function loadWorkspace(): string | null {
  // MAS 沙箱下优先用 security-scoped bookmark 恢复访问权限
  const bookmark = getSetting(BOOKMARK_KEY)
  if (bookmark) {
    const restored = startWorkspaceAccess(bookmark)
    if (restored) {
      if (restored.bookmark) setSetting(BOOKMARK_KEY, restored.bookmark)
      if (existsSync(restored.path)) {
        root = restored.path
        setSetting(SETTING_KEY, restored.path)
        return root
      }
    }
  }
  const saved = getSetting(SETTING_KEY)
  if (saved && existsSync(saved)) {
    root = saved
    return root
  }
  return null
}

export async function setWorkspace(dir: string): Promise<void> {
  const abs = resolve(dir)
  await fs.mkdir(abs, { recursive: true })
  root = abs
  setSetting(SETTING_KEY, abs)
  const bookmark = createWorkspaceBookmark(abs)
  if (bookmark) {
    setSetting(BOOKMARK_KEY, bookmark)
    startWorkspaceAccess(bookmark)
  }
  await reindex()
}

export function requireRoot(): string {
  if (!root) throw new Error('未选择工作区')
  return root
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

export function toRel(abs: string): string {
  return toPosix(relative(requireRoot(), abs))
}

function resolveDocPath(id: string): string {
  const abs = resolve(requireRoot(), id)
  const base = requireRoot()
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error('非法文档路径')
  }
  return abs
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue
      walk(full, out)
    } else if (st.isFile() && extname(name).toLowerCase() === '.md') {
      out.push(full)
    }
  }
}

export function parseDoc(raw: string, fallbackTitle: string): {
  meta: Pick<DocumentMeta, 'title' | 'tags' | 'summary' | 'cover' | 'frontMatter'>
  body: string
} {
  let data: Record<string, unknown> = {}
  let body = raw
  try {
    const parsed = matter(raw)
    data = parsed.data as Record<string, unknown>
    body = parsed.content
  } catch {
    // 非法 front-matter：按纯正文处理
  }
  const headingMatch = body.match(/^\s*#\s+(.+?)\s*$/m)
  const title =
    (typeof data.title === 'string' && data.title.trim()) ||
    (headingMatch ? headingMatch[1].trim() : '') ||
    fallbackTitle

  let tags: string[] = []
  if (Array.isArray(data.tags)) {
    tags = data.tags.map((t) => String(t).trim()).filter(Boolean)
  } else if (typeof data.tags === 'string') {
    tags = data.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  return {
    meta: {
      title,
      tags,
      summary: typeof data.summary === 'string' ? data.summary : undefined,
      cover: typeof data.cover === 'string' ? data.cover : undefined,
      frontMatter: data
    },
    body
  }
}

function upsertIndex(abs: string): DocumentMeta {
  const id = toRel(abs)
  const st = statSync(abs)
  const raw = readDocFileSync(abs)
  const { meta } = parseDoc(raw, basename(abs, extname(abs)))
  const record: DocumentMeta = {
    id,
    dir: toPosix(dirname(id) === '.' ? '' : dirname(id)),
    mtime: Math.round(st.mtimeMs),
    size: st.size,
    ...meta
  }
  getDb()
    .prepare(
      `INSERT INTO documents(id, title, dir, mtime, size, tags, summary, cover)
       VALUES(@id, @title, @dir, @mtime, @size, @tags, @summary, @cover)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, dir=excluded.dir, mtime=excluded.mtime, size=excluded.size,
         tags=excluded.tags, summary=excluded.summary, cover=excluded.cover`
    )
    .run({
      ...record,
      tags: JSON.stringify(record.tags),
      summary: record.summary ?? null,
      cover: record.cover ?? null
    })
  return record
}

function readDocFileSync(abs: string): string {
  return readFileSync(abs, 'utf8')
}

export async function reindex(): Promise<DocumentMeta[]> {
  if (!root) return []
  const files: string[] = []
  walk(root, files)
  const ids = new Set<string>()
  const metas: DocumentMeta[] = []
  for (const abs of files) {
    try {
      const meta = upsertIndex(abs)
      ids.add(meta.id)
      metas.push(meta)
    } catch {
      continue
    }
  }
  const existing = getDb().prepare('SELECT id FROM documents').all() as Array<{ id: string }>
  const del = getDb().prepare('DELETE FROM documents WHERE id = ?')
  for (const row of existing) {
    if (!ids.has(row.id)) del.run(row.id)
  }
  metas.sort((a, b) => a.id.localeCompare(b.id))
  return metas
}

export function listDocs(): DocumentMeta[] {
  const rows = getDb()
    .prepare('SELECT * FROM documents ORDER BY id')
    .all() as Array<Omit<DocumentMeta, 'tags' | 'frontMatter'> & { tags: string }>
  return rows.map((r) => ({
    ...r,
    tags: safeParseTags(r.tags),
    frontMatter: {}
  }))
}

function safeParseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function readDoc(id: string): Promise<DocumentContent> {
  const abs = resolveDocPath(id)
  const raw = await fs.readFile(abs, 'utf8')
  const st = await fs.stat(abs)
  const { meta, body } = parseDoc(raw, basename(abs, extname(abs)))
  return {
    id,
    dir: toPosix(dirname(id) === '.' ? '' : dirname(id)),
    mtime: Math.round(st.mtimeMs),
    size: st.size,
    raw,
    body,
    ...meta
  }
}

function slugify(title: string): string {
  const s = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
  return s || 'untitled'
}

function uniquePath(dir: string, name: string): string {
  const base = join(dir, `${name}.md`)
  if (!existsSync(base)) return base
  for (let i = 1; i < 1000; i++) {
    const p = join(dir, `${name}-${i}.md`)
    if (!existsSync(p)) return p
  }
  throw new Error('无法生成唯一文件名')
}

export async function createDoc(input: CreateDocInput): Promise<DocumentMeta> {
  const base = requireRoot()
  const dirRel = input.dir ?? ''
  const dirAbs = resolve(base, dirRel)
  if (dirAbs !== base && !dirAbs.startsWith(base + sep)) throw new Error('非法目录')
  await fs.mkdir(dirAbs, { recursive: true })
  const title = input.title?.trim() || '未命名文档'
  const file = uniquePath(dirAbs, slugify(title))
  const template = `---\ntitle: ${title}\ntags: []\n---\n\n# ${title}\n\n`
  await fs.writeFile(file, template, 'utf8')
  return upsertIndex(file)
}

export async function saveDoc(id: string, raw: string): Promise<DocumentMeta> {
  const abs = resolveDocPath(id)
  const tmp = `${abs}.tmp`
  await fs.writeFile(tmp, raw, 'utf8')
  await fs.rename(tmp, abs)
  return upsertIndex(abs)
}

export async function renameDoc(input: RenameDocInput): Promise<DocumentMeta> {
  const abs = resolveDocPath(input.id)
  const raw = await fs.readFile(abs, 'utf8')
  const { body } = parseDoc(raw, basename(abs, extname(abs)))
  const fm = `---\ntitle: ${input.title}\n---\n\n`
  await fs.writeFile(abs, fm + body.replace(/^\s+/, ''), 'utf8')
  return upsertIndex(abs)
}

export async function deleteDoc(id: string): Promise<void> {
  const abs = resolveDocPath(id)
  await fs.rm(abs, { force: true })
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id)
}

export function resolveForReveal(id: string): string {
  return resolveDocPath(id)
}

/** DB 索引中缺失或 mtime 变化的文件路径，供 watcher 增量更新 */
export function indexSingle(abs: string): DocumentMeta {
  return upsertIndex(abs)
}

export function removeFromIndex(abs: string): void {
  try {
    const id = toRel(abs)
    getDb().prepare('DELETE FROM documents WHERE id = ?').run(id)
  } catch {
    // 工作区未设置时忽略
  }
}
