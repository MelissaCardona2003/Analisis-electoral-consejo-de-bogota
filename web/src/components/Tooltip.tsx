import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface TipState {
  x: number
  y: number
  content: ReactNode
}

/** Tooltip flotante que sigue al puntero y se mantiene dentro de la ventana. */
export function FloatingTip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useEffect(() => {
    if (!tip || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const pad = 14
    let left = tip.x + pad
    let top = tip.y + pad
    if (left + r.width > window.innerWidth - 8) left = tip.x - r.width - pad
    if (top + r.height > window.innerHeight - 8) top = tip.y - r.height - pad
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[100] min-w-40 max-w-72 rounded-xl border border-[var(--ring)] bg-surface px-3 py-2.5 text-[13px] text-ink shadow-[var(--shadow)]"
      style={{ left: pos.left, top: pos.top }}
    >
      {tip.content}
    </div>,
    document.body,
  )
}

export function TipRow({ color, label, value, strong }: { color?: string; label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex min-w-0 items-center gap-2 text-ink-2">
        {color && <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={`tabular shrink-0 ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
