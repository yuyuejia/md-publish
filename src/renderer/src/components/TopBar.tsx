import { FolderOpen, Save, Columns, Code2, Eye, Send, Link2 } from 'lucide-react'
import { useAppStore, type ViewMode } from '../stores/useAppStore'
import { cn } from '../lib/cn'

interface TopBarProps {
  publishOpen: boolean
  onTogglePublish: () => void
  syncScroll: boolean
  onToggleSyncScroll: () => void
}

const views: Array<{ id: ViewMode; icon: React.JSX.Element; label: string }> = [
  { id: 'editor', icon: <Code2 size={15} />, label: '编辑' },
  { id: 'split', icon: <Columns size={15} />, label: '分栏' },
  { id: 'preview', icon: <Eye size={15} />, label: '预览' }
]

export function TopBar({
  publishOpen,
  onTogglePublish,
  syncScroll,
  onToggleSyncScroll
}: TopBarProps): React.JSX.Element {
  const root = useAppStore((s) => s.root)
  const active = useAppStore((s) => s.active)
  const dirty = useAppStore((s) => s.dirty)
  const saving = useAppStore((s) => s.saving)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const save = useAppStore((s) => s.save)
  const chooseWorkspace = useAppStore((s) => s.chooseWorkspace)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel px-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-accent text-xs font-bold text-white">
          M
        </div>
        <span className="text-sm font-semibold text-fg">md-publish</span>
      </div>

      <button
        onClick={() => void chooseWorkspace()}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-panel2"
        title={root ?? '未选择工作区'}
      >
        <FolderOpen size={14} />
        <span className="max-w-[220px] truncate">{root ?? '选择工作区'}</span>
      </button>

      <div className="min-w-0 flex-1 truncate text-center text-xs text-faint">
        {active ? (
          <>
            {active.title}
            {dirty ? <span className="ml-1 text-amber-400">●</span> : null}
          </>
        ) : (
          '未打开文档'
        )}
      </div>

      <div className="flex items-center rounded-md bg-panel2 p-0.5">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            title={v.label}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              view === v.id ? 'bg-accent text-white' : 'text-muted hover:text-fg'
            )}
          >
            {v.icon}
          </button>
        ))}
      </div>

      {view === 'split' && (
        <button
          onClick={onToggleSyncScroll}
          title={syncScroll ? '同步滚动：开' : '同步滚动：关'}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
            syncScroll ? 'bg-accent text-white' : 'text-muted hover:bg-panel2'
          )}
        >
          <Link2 size={14} />
        </button>
      )}

      <button
        onClick={() => void save()}
        disabled={!active || saving}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-panel2 disabled:opacity-40"
        title="保存 (⌘/Ctrl+S)"
      >
        <Save size={14} /> 保存
      </button>

      <button
        onClick={onTogglePublish}
        disabled={!active}
        className={cn(
          'flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-40',
          publishOpen ? 'bg-accent text-white' : 'bg-panel2 text-fg hover:bg-edge'
        )}
      >
        <Send size={14} /> 发布
      </button>
    </header>
  )
}
