import { useDeferredValue, useMemo, type Ref } from 'react'
import { renderMarkdownPreview } from '@shared/markdown'
import { useAppStore } from '../stores/useAppStore'
import { resolveImageSrc, toPosix } from '../lib/assets'

interface PreviewProps {
  markdownText: string
  scrollRef?: Ref<HTMLDivElement>
}

export function Preview({ markdownText, scrollRef }: PreviewProps): React.JSX.Element {
  const root = useAppStore((s) => s.root)
  const active = useAppStore((s) => s.active)

  const baseDir = useMemo(() => {
    if (!root) return null
    return active?.dir ? `${toPosix(root)}/${active.dir}` : toPosix(root)
  }, [root, active])

  // 输入时让预览延后渲染，保证编辑不卡顿
  const deferredText = useDeferredValue(markdownText)

  const html = useMemo(() => {
    const raw = renderMarkdownPreview(deferredText)
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src')
      if (!src) return
      img.setAttribute('src', resolveImageSrc(src, baseDir, root))
    })
    return doc.body.innerHTML
  }, [deferredText, baseDir, root])

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-panel">
      <div className="relative mx-auto max-w-[760px] px-8 py-6">
        <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
