import { create } from 'zustand'
import type { DocumentContent, DocumentMeta, PlatformMeta, PublishRecord } from '@shared/types'
import { EVT } from '@shared/ipc'

export type ViewMode = 'split' | 'editor' | 'preview'

interface AppState {
  root: string | null
  docs: DocumentMeta[]
  activeId: string | null
  active: DocumentContent | null
  draft: string
  dirty: boolean
  saving: boolean
  view: ViewMode
  platforms: PlatformMeta[]
  records: PublishRecord[]
  statusText: string

  init: () => Promise<void>
  chooseWorkspace: () => Promise<void>
  refreshDocs: () => Promise<void>
  selectDoc: (id: string) => Promise<void>
  setDraft: (text: string) => void
  save: () => Promise<void>
  createDoc: (dir?: string) => Promise<void>
  removeDoc: (id: string) => Promise<void>
  renameDoc: (id: string, title: string) => Promise<void>
  setView: (v: ViewMode) => void
  refreshRecords: (docId?: string) => Promise<void>
  setStatus: (text: string) => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  root: null,
  docs: [],
  activeId: null,
  active: null,
  draft: '',
  dirty: false,
  saving: false,
  view: 'split',
  platforms: [],
  records: [],
  statusText: '就绪',

  init: async () => {
    window.api.on(EVT.docChanged, () => {
      void get().refreshDocs()
    })
    const { root } = await window.api.workspace.get()
    set({ root })
    const platforms = await window.api.platforms.list()
    set({ platforms })
    if (root) await get().refreshDocs()
  },

  chooseWorkspace: async () => {
    const { root } = await window.api.workspace.choose()
    set({ root, active: null, activeId: null, draft: '' })
    if (root) await get().refreshDocs()
  },

  refreshDocs: async () => {
    if (!get().root) return
    const docs = await window.api.docs.list()
    set({ docs })
  },

  selectDoc: async (id: string) => {
    const active = await window.api.docs.read(id)
    set({ active, activeId: id, draft: active.raw, dirty: false })
    await get().refreshRecords(id)
  },

  setDraft: (text: string) => {
    set({ draft: text, dirty: true })
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void get().save()
    }, 900)
  },

  save: async () => {
    const { activeId, draft, dirty } = get()
    if (!activeId || !dirty) return
    set({ saving: true })
    try {
      const meta = await window.api.docs.save({ id: activeId, raw: draft })
      const active = get().active
      if (active && active.id === meta.id) {
        const parsed = getMarkdownMeta(draft, meta)
        set({ active: { ...active, ...parsed, raw: draft }, dirty: false })
      }
      await get().refreshDocs()
      set({ statusText: `已保存 ${new Date().toLocaleTimeString()}` })
    } finally {
      set({ saving: false })
    }
  },

  createDoc: async (dir?: string) => {
    const meta = await window.api.docs.create({ dir })
    await get().refreshDocs()
    await get().selectDoc(meta.id)
  },

  removeDoc: async (id: string) => {
    await window.api.docs.remove(id)
    const wasActive = get().activeId === id
    await get().refreshDocs()
    if (wasActive) {
      set({ active: null, activeId: null, draft: '', dirty: false })
    }
  },

  renameDoc: async (id: string, title: string) => {
    await window.api.docs.rename({ id, title })
    await get().refreshDocs()
    if (get().activeId === id) await get().selectDoc(id)
  },

  setView: (v: ViewMode) => set({ view: v }),

  refreshRecords: async (docId?: string) => {
    const records = await window.api.records.list(docId)
    set({ records })
  },

  setStatus: (text: string) => set({ statusText: text })
}))

function getMarkdownMeta(
  draft: string,
  meta: DocumentMeta
): Pick<DocumentContent, 'title' | 'tags' | 'summary' | 'cover'> {
  const heading = draft.match(/^\s*#\s+(.+?)\s*$/m)
  const title = heading ? heading[1].trim() : meta.title
  return { title, tags: meta.tags, summary: meta.summary, cover: meta.cover }
}
