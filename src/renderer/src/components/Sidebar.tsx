import { useMemo, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FilePlus,
  Folder,
  FolderOpen,
  Trash2,
  Pencil,
  Search
} from 'lucide-react'
import type { DocumentMeta } from '@shared/types'
import { useAppStore } from '../stores/useAppStore'
import { ancestorsOf, buildTree, filterTree, type TreeNode } from '../lib/tree'
import { cn } from '../lib/cn'

export function Sidebar({ width }: { width: number }): React.JSX.Element {
  const docs = useAppStore((s) => s.docs)
  const activeId = useAppStore((s) => s.activeId)
  const selectDoc = useAppStore((s) => s.selectDoc)
  const createDoc = useAppStore((s) => s.createDoc)
  const removeDoc = useAppStore((s) => s.removeDoc)
  const renameDoc = useAppStore((s) => s.renameDoc)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const tree = useMemo(() => buildTree(docs), [docs])
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => filterTree(tree, q), [tree, q])
  const activeAncestors = useMemo(
    () => new Set(activeId ? ancestorsOf(activeId) : []),
    [activeId]
  )

  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const startRename = (id: string, title: string): void => {
    setEditingId(id)
    setEditingValue(title)
  }

  const commitRename = async (id: string): Promise<void> => {
    const value = editingValue.trim()
    if (value) await renameDoc(id, value)
    setEditingId(null)
  }

  const renderNodes = (nodes: TreeNode[], depth: number): React.JSX.Element[] =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${8 + depth * 14}px` }

      if (node.isDir) {
        const isCollapsed = collapsed.has(node.path) && !activeAncestors.has(node.path)
        return (
          <div key={`d:${node.path}`}>
            <div
              className="group flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted hover:bg-panel2/60"
              style={indent}
            >
              <button
                onClick={() => toggleDir(node.path)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                title={node.path}
              >
                {isCollapsed ? (
                  <ChevronRight size={14} className="shrink-0 text-faint" />
                ) : (
                  <ChevronDown size={14} className="shrink-0 text-faint" />
                )}
                {isCollapsed ? (
                  <Folder size={14} className="shrink-0 text-sky-400/80" />
                ) : (
                  <FolderOpen size={14} className="shrink-0 text-sky-400/80" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              <button
                onClick={() => void createDoc(node.path)}
                className="hidden text-faint hover:text-fg group-hover:block"
                title="在此目录新建文档"
              >
                <FilePlus size={13} />
              </button>
            </div>
            {!isCollapsed && (
              <div className="relative">
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-edge"
                  style={{ left: `${15 + depth * 14}px` }}
                />
                {renderNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        )
      }

      const doc = node.doc as DocumentMeta
      const active = doc.id === activeId
      return (
        <div
          key={`f:${doc.id}`}
          className={cn(
            'group flex items-center gap-1 rounded-md py-1 pr-2 text-sm',
            active ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2/60'
          )}
          style={indent}
        >
          <FileText size={14} className="shrink-0 text-faint" />
          {editingId === doc.id ? (
            <input
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={() => void commitRename(doc.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(doc.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="min-w-0 flex-1 rounded bg-panel px-1 text-sm outline-none ring-1 ring-accent"
            />
          ) : (
            <button
              onClick={() => void selectDoc(doc.id)}
              className="min-w-0 flex-1 truncate text-left"
              title={doc.id}
            >
              {doc.title}
            </button>
          )}
          <div className="hidden items-center gap-1 group-hover:flex">
            <button
              onClick={() => startRename(doc.id, doc.title)}
              className="text-faint hover:text-fg"
              title="重命名"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`确认删除「${doc.title}」？`)) void removeDoc(doc.id)
              }}
              className="text-faint hover:text-red-400"
              title="删除"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )
    })

  return (
    <aside className="flex shrink-0 flex-col overflow-hidden bg-panel" style={{ width }}>
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-panel2 px-2 py-1.5">
          <Search size={14} className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档"
            className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-1.5 pb-4">
        {docs.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-faint">暂无文档</p>
        )}
        {docs.length > 0 && !visible && (
          <p className="px-2 py-6 text-center text-xs text-faint">没有匹配的文档</p>
        )}
        {visible && renderNodes(visible.children, 0)}
      </div>
    </aside>
  )
}
