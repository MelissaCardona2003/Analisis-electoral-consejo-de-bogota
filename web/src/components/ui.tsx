import type { ReactNode } from 'react'
import type { Familia } from '../lib/types'

export function famColor(id: string) {
  return `var(--fam-${id})`
}

export function SectionHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string
  title: ReactNode
  lede?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-10 grid gap-6 md:mb-14 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="max-w-3xl">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display mt-3 text-[2.6rem] leading-[1.02] text-ink md:text-6xl">{title}</h1>
        {lede && <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-ink-2">{lede}</p>}
      </div>
      {children}
    </header>
  )
}

export function Card({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={`card p-5 md:p-7 ${className}`}>{children}</Tag>
}

export function CardTitle({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[1.05rem] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-sm leading-snug text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function StatTile({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-hairline bg-surface px-4 py-4 md:px-5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[1.75rem] font-semibold leading-none tracking-tight text-ink md:text-[2rem]">{value}</span>
      {detail && (
        <span className={`text-[13px] ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-critical' : 'text-ink-2'}`}>{detail}</span>
      )}
    </div>
  )
}

export function Dot({ familia, size = 10, ring = false }: { familia: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: ring ? 'transparent' : famColor(familia),
        boxShadow: ring ? `inset 0 0 0 2px var(--ink)` : undefined,
      }}
    />
  )
}

export function Legend({ familias, activo, onActivar }: { familias: Familia[]; activo?: string | null; onActivar?: (id: string | null) => void }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Leyenda de familias políticas">
      {familias.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onPointerEnter={() => onActivar?.(f.id)}
            onPointerLeave={() => onActivar?.(null)}
            onFocus={() => onActivar?.(f.id)}
            onBlur={() => onActivar?.(null)}
            className={`flex items-center gap-2 text-[13px] transition-opacity ${activo && activo !== f.id ? 'opacity-40' : ''}`}
          >
            <Dot familia={f.id} />
            <span className="text-ink-2">{f.nombre_corto}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-full border border-hairline bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full font-medium transition-all ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]'} ${
            value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-[var(--ring)]' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Callout({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <aside className="rounded-2xl border border-hairline bg-surface-2 px-5 py-4 text-[14px] leading-relaxed text-ink-2">
      {title && <p className="mb-1 font-semibold text-ink">{title}</p>}
      {children}
    </aside>
  )
}

export function TablaToggle({ abierta, onToggle }: { abierta: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="text-[13px] font-medium text-ink-2 link-underline">
      {abierta ? 'Ver gráfico' : 'Ver tabla'}
    </button>
  )
}
