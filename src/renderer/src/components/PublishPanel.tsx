import { useEffect, useState } from 'react'
import {
  X,
  LogIn,
  LogOut,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Info
} from 'lucide-react'
import type { AuthResult, PlatformId, SyncResult } from '@shared/types'
import type { PublishProgress } from '@shared/ipc'
import { EVT } from '@shared/ipc'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/cn'

interface PublishPanelProps {
  open: boolean
  onClose: () => void
}

export function PublishPanel({ open, onClose }: PublishPanelProps): React.JSX.Element | null {
  const platforms = useAppStore((s) => s.platforms)
  const active = useAppStore((s) => s.active)
  const records = useAppStore((s) => s.records)
  const refreshRecords = useAppStore((s) => s.refreshRecords)

  const [selected, setSelected] = useState<Set<PlatformId>>(new Set())
  const [auth, setAuth] = useState<Partial<Record<PlatformId, AuthResult>>>({})
  const [results, setResults] = useState<SyncResult[]>([])
  const [busy, setBusy] = useState<PlatformId | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [progress, setProgress] = useState<PublishProgress | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      for (const p of platforms) {
        try {
          const r = await window.api.platforms.checkAuth(p.id)
          if (!cancelled) setAuth((prev) => ({ ...prev, [p.id]: r }))
        } catch {
          /* ignore */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, platforms])

  useEffect(() => {
    const off = window.api.on(EVT.publishProgress, (payload) => {
      setProgress(payload as PublishProgress)
    })
    return off
  }, [])

  if (!open) return null

  const toggle = (id: PlatformId): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doLogin = async (id: PlatformId): Promise<void> => {
    setBusy(id)
    try {
      const r = await window.api.platforms.login(id)
      setAuth((prev) => ({ ...prev, [id]: r }))
    } finally {
      setBusy(null)
    }
  }

  const doLogout = async (id: PlatformId): Promise<void> => {
    if (!window.confirm('确认重置该平台的登录状态？需重新登录后才能发布。')) return
    setBusy(id)
    try {
      await window.api.platforms.logout(id)
      setAuth((prev) => ({ ...prev, [id]: { isAuthenticated: false } }))
    } finally {
      setBusy(null)
    }
  }

  const doPublish = async (): Promise<void> => {
    if (!active || selected.size === 0) return
    setPublishing(true)
    setResults([])
    try {
      const res = await window.api.platforms.publish({
        docId: active.id,
        platforms: [...selected],
        options: { draftOnly: true }
      })
      setResults(res)
      await refreshRecords(active.id)
    } finally {
      setPublishing(false)
      setProgress(null)
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex h-12 items-center justify-between border-b border-edge px-3">
        <span className="text-sm font-semibold text-fg">发布</span>
        <button onClick={onClose} className="text-faint hover:text-fg">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            目标平台
          </h3>
          <div className="space-y-1.5">
            {platforms.map((p) => {
              const status = auth[p.id]
              const checked = selected.has(p.id)
              const loggedIn = status?.isAuthenticated
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-md border p-2',
                    checked ? 'border-accent/60 bg-panel2' : 'border-edge'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      disabled={!loggedIn}
                      className="accent-accent"
                    />
                    <span className="flex-1 text-sm text-fg">{p.name}</span>
                    {loggedIn ? (
                      <span className="flex items-center gap-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-green-400">
                          <CheckCircle2 size={12} />
                          {status?.username ?? '已登录'}
                        </span>
                        <button
                          onClick={() => void doLogout(p.id)}
                          disabled={busy === p.id}
                          title="重置登录状态"
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-panel2 hover:text-fg"
                        >
                          {busy === p.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <LogOut size={12} />
                          )}
                          重置
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => void doLogin(p.id)}
                        disabled={busy === p.id}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-panel2"
                      >
                        {busy === p.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <LogIn size={12} />
                        )}
                        登录
                      </button>
                    )}
                  </div>
                  {!loggedIn && status?.error && (
                    <p className="mt-1 text-[11px] leading-snug text-red-400/90">{status.error}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="mb-4">
          <p className="flex items-start gap-1.5 rounded-md bg-panel2 px-2 py-1.5 text-xs leading-relaxed text-muted">
            <Info size={13} className="mt-0.5 shrink-0 text-accent" />
            发布后统一保存为草稿，请到各平台草稿箱确认排版后再正式发布。
          </p>
        </section>

        <button
          onClick={() => void doPublish()}
          disabled={!active || selected.size === 0 || publishing}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {publishing ? <Loader2 size={15} className="animate-spin" /> : null}
          {publishing ? '发布中…' : `发布到 ${selected.size} 个平台`}
        </button>

        {progress && publishing && (
          <p className="mb-3 text-center text-xs text-muted">
            {progress.platform} · {progress.phase}
            {progress.message ? ` · ${progress.message}` : ''}
          </p>
        )}

        {results.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
              本次结果
            </h3>
            <div className="space-y-1.5">
              {results.map((r) => (
                <div key={r.platform} className="rounded-md border border-edge p-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {r.success ? (
                      <CheckCircle2 size={13} className="text-green-400" />
                    ) : (
                      <XCircle size={13} className="text-red-400" />
                    )}
                    <span className="text-fg">{r.platform}</span>
                    {r.postUrl && (
                      <a
                        href={r.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-1 text-accent"
                      >
                        查看 <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  {r.error && <p className="mt-1 text-red-400/90">{r.error}</p>}
                  {r.warning && <p className="mt-1 text-amber-400/90">{r.warning}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            发布记录
          </h3>
          {records.length === 0 ? (
            <p className="text-xs text-faint">暂无记录</p>
          ) : (
            <div className="space-y-1.5">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center gap-2 rounded-md border border-edge p-2 text-xs"
                >
                  {rec.status === 'success' ? (
                    <CheckCircle2 size={12} className="text-green-400" />
                  ) : (
                    <XCircle size={12} className="text-red-400" />
                  )}
                  <span className="text-muted">{rec.platform}</span>
                  <span className="text-faint">
                    {new Date(rec.createdAt).toLocaleString()}
                  </span>
                  {rec.postUrl && (
                    <a
                      href={rec.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-accent"
                    >
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
