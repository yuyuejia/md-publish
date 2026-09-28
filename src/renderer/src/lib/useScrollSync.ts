import { useEffect } from 'react'
import { EditorView } from '@codemirror/view'

const GUARD_MS = 80

/**
 * 编辑器与预览的滚动同步：基于行号映射（预览元素带 data-line）。
 * 以 80ms 时间窗抑制程序化滚动引发的回声。
 */
export function useScrollSync(
  view: EditorView | null,
  preview: HTMLElement | null,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled || !view || !preview) return
    const scroller = view.scrollDOM
    let until = 0

    const lineAtEditorTop = (): number => {
      const block = view.lineBlockAtHeight(scroller.scrollTop)
      return view.state.doc.lineAt(block.from).number - 1
    }

    const blocks = (): HTMLElement[] =>
      Array.from(preview.querySelectorAll<HTMLElement>('[data-line]'))

    const firstBlockAtOrAfter = (line: number): HTMLElement | null => {
      const els = blocks()
      let best: HTMLElement | null = null
      let bestLine = -1
      for (const el of els) {
        const l = Number(el.dataset.line)
        if (Number.isNaN(l) || l > line) continue
        if (l > bestLine) {
          bestLine = l
          best = el
        }
      }
      return best ?? els[0] ?? null
    }

    const onEditorScroll = (): void => {
      if (performance.now() < until) return
      until = performance.now() + GUARD_MS
      const el = firstBlockAtOrAfter(lineAtEditorTop())
      if (el) preview.scrollTop = el.offsetTop
    }

    const onPreviewScroll = (): void => {
      if (performance.now() < until) return
      until = performance.now() + GUARD_MS
      const top = preview.scrollTop + 4
      let line = 0
      for (const el of blocks()) {
        if (el.offsetTop <= top) line = Number(el.dataset.line)
        else break
      }
      const lineNumber = Math.min(line + 1, view.state.doc.lines)
      const pos = view.state.doc.line(lineNumber).from
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
    }

    scroller.addEventListener('scroll', onEditorScroll, { passive: true })
    preview.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onEditorScroll)
      preview.removeEventListener('scroll', onPreviewScroll)
    }
  }, [view, preview, enabled])
}
