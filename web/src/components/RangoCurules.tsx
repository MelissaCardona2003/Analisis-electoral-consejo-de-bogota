import { useState } from 'react'
import type { DistCurules } from '../lib/types'
import { pct } from '../lib/format'
import { FloatingTip, TipRow, type TipState } from './Tooltip'

interface Fila {
  id: string
  label: string
  familia: string
  curules: DistCurules
  referencia?: number
  referenciaLabel?: string
  extra?: string
}

/**
 * Intervalo de curules por fila: barra fina del 80 %, bigotes del 95 %, punto en la mediana
 * y un anillo con la referencia (p. ej. las curules de 2023).
 */
export function RangoCurules({ filas, maximo, onSelect }: { filas: Fila[]; maximo?: number; onSelect?: (id: string) => void }) {
  const max = maximo ?? Math.max(12, ...filas.map((f) => Math.ceil(f.curules.p975)), ...filas.map((f) => f.referencia ?? 0)) + 1
  const x = (v: number) => `${(v / max) * 100}%`
  const [tip, setTip] = useState<TipState | null>(null)
  const ticks = Array.from({ length: Math.floor(max / 5) + 1 }, (_, i) => i * 5)

  return (
    <div>
      <div className="relative ml-[10.5rem] mr-14 hidden h-5 text-[11px] text-muted sm:block" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="tabular absolute -translate-x-1/2" style={{ left: x(t) }}>
            {t}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-[var(--hairline)]">
        {filas.map((f) => {
          const c = f.curules
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect?.(f.id)}
                onPointerMove={(e) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    content: (
                      <div>
                        <p className="mb-1.5 font-semibold">{f.label}</p>
                        <TipRow label="Mediana" value={`${Math.round(c.p50)} curules`} strong />
                        <TipRow label="80 % de escenarios" value={`${Math.round(c.p10)}–${Math.round(c.p90)}`} />
                        <TipRow label="95 % de escenarios" value={`${Math.round(c.p025)}–${Math.round(c.p975)}`} />
                        <TipRow label="Sin curules" value={pct(c.p_cero, 0)} />
                        {f.referencia !== undefined && <TipRow label={f.referenciaLabel ?? 'Referencia'} value={f.referencia} />}
                      </div>
                    ),
                  })
                }
                onPointerLeave={() => setTip(null)}
                className="group grid w-full grid-cols-[9.5rem_1fr_2.5rem] items-center gap-4 py-2.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--fam-${f.familia})` }} />
                  <span className="truncate text-[13px] text-ink-2 group-hover:text-ink">{f.label}</span>
                </span>
                <span className="relative block h-6">
                  <span className="absolute inset-y-1/2 left-0 right-0 h-px bg-[var(--hairline)]" />
                  {ticks.map((t) => (
                    <span key={t} className="absolute top-1 bottom-1 w-px bg-[var(--hairline)]" style={{ left: x(t) }} />
                  ))}
                  <span
                    className="absolute top-1/2 h-px -translate-y-1/2"
                    style={{ left: x(c.p025), width: x(c.p975 - c.p025), background: `var(--fam-${f.familia})`, opacity: 0.55 }}
                  />
                  <span
                    className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
                    style={{ left: x(c.p10), width: `max(${x(c.p90 - c.p10)}, 4px)`, background: `var(--fam-${f.familia})`, opacity: 0.35 }}
                  />
                  {f.referencia !== undefined && (
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface"
                      style={{ left: x(f.referencia) }}
                    />
                  )}
                  <span
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)] transition-transform group-hover:scale-125"
                    style={{ left: x(c.p50), background: `var(--fam-${f.familia})` }}
                  />
                </span>
                <span className="tabular text-right text-[15px] font-semibold text-ink">{Math.round(c.p50)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <FloatingTip tip={tip} />
    </div>
  )
}
