import type { PointerEvent as ReactPointerEvent } from 'react'

interface PanelResizerProps {
  width: number
  onChange: (width: number) => void
  min?: number
  max?: number
}

/** 可拖拽的竖直分隔条，用于调整相邻面板宽度 */
export function PanelResizer({
  width,
  onChange,
  min = 180,
  max = 560
}: PanelResizerProps): React.JSX.Element {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent): void => {
      onChange(Math.min(max, Math.max(min, startWidth + ev.clientX - startX)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className="group relative z-10 -ml-px w-1.5 shrink-0 cursor-col-resize"
      title="拖拽调整宽度"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge transition-colors group-hover:bg-accent" />
    </div>
  )
}
