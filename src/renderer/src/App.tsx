import { useEffect, useState } from 'react'
import { FolderOpen, FileText } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { useAppStore } from './stores/useAppStore'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { PanelResizer } from './components/PanelResizer'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { PublishPanel } from './components/PublishPanel'
import { useScrollSync } from './lib/useScrollSync'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560

function Welcome(): React.JSX.Element {
  const chooseWorkspace = useAppStore((s) => s.chooseWorkspace)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-panel text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-2xl font-bold text-white">
        M
      </div>
      <div>
        <h1 className="text-xl font-semibold text-fg">md-publish</h1>
        <p className="mt-1 text-sm text-faint">
          选择一个文件夹作为 Markdown 工作区，开始写作并发布到微信公众号 / 掘金 / 知乎 / 今日头条 / 开源中国
        </p>
      </div>
      <button
        onClick={() => void chooseWorkspace()}
        className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110"
      >
        <FolderOpen size={16} /> 选择工作区
      </button>
    </div>
  )
}

function StatusBar(): React.JSX.Element {
  const statusText = useAppStore((s) => s.statusText)
  const active = useAppStore((s) => s.active)
  const dirty = useAppStore((s) => s.dirty)
  const saving = useAppStore((s) => s.saving)
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-edge bg-panel px-3 text-[11px] text-faint">
      <span>{statusText}</span>
      {active && (
        <span className="ml-auto">
          {active.id} · {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
        </span>
      )}
    </footer>
  )
}

export default function App(): React.JSX.Element {
  const init = useAppStore((s) => s.init)
  const root = useAppStore((s) => s.root)
  const active = useAppStore((s) => s.active)
  const draft = useAppStore((s) => s.draft)
  const setDraft = useAppStore((s) => s.setDraft)
  const save = useAppStore((s) => s.save)
  const view = useAppStore((s) => s.view)
  const [publishOpen, setPublishOpen] = useState(false)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null)
  const [syncScroll, setSyncScroll] = useState(() => localStorage.getItem('ui.syncScroll') !== '0')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem('ui.sidebarWidth'))
    return Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 256
  })

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    localStorage.setItem('ui.sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem('ui.syncScroll', syncScroll ? '1' : '0')
  }, [syncScroll])

  useScrollSync(editorView, previewEl, view === 'split' && syncScroll)

  if (!root) {
    return (
      <div className="h-full bg-panel">
        <Welcome />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <TopBar
        publishOpen={publishOpen}
        onTogglePublish={() => setPublishOpen((v) => !v)}
        syncScroll={syncScroll}
        onToggleSyncScroll={() => setSyncScroll((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar width={sidebarWidth} />
        <PanelResizer
          width={sidebarWidth}
          onChange={setSidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
        />
        <main className="flex min-w-0 flex-1">
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-faint">
              <FileText size={28} />
              <p className="text-sm">从左侧选择或新建一篇文档</p>
            </div>
          ) : (
            <>
              {(view === 'editor' || view === 'split') && (
                <div className={view === 'split' ? 'w-1/2 border-r border-edge' : 'flex-1'}>
                  <Editor
                    value={draft}
                    onChange={setDraft}
                    onSave={() => void save()}
                    onReady={setEditorView}
                  />
                </div>
              )}
              {(view === 'preview' || view === 'split') && (
                <div className={view === 'split' ? 'w-1/2' : 'flex-1'}>
                  <Preview markdownText={draft} scrollRef={setPreviewEl} />
                </div>
              )}
            </>
          )}
        </main>
        <PublishPanel open={publishOpen} onClose={() => setPublishOpen(false)} />
      </div>
      <StatusBar />
    </div>
  )
}
