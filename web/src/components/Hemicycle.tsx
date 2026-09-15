import { useMemo, useState } from 'react'

export interface GrupoCurules {
  id: string
  label: string
  familia: string
  curules: number
  /** curul del Estatuto de la Oposición (se dibuja como anillo) */
  oposicion?: boolean
}

interface Props {
  grupos: GrupoCurules[]
  filas?: number
  resaltado?: string | null
  onResaltar?: (id: string | null) => void
  etiquetaCentro?: string
  subCentro?: string
  className?: string
}

interface Asiento {
  x: number
  y: number
  angulo: number
}

/** Distribuye n asientos en filas concéntricas proporcionales a su radio, ordenados de izquierda a derecha. */
function disposicion(n: number, filas: number, interior = 0.38): { asientos: Asiento[]; radio: number } {
  const radios = Array.from({ length: filas }, (_, i) => interior + ((1 - interior) * (i + 0.5)) / filas)
  const suma = radios.reduce((a, b) => a + b, 0)
  const conteos = radios.map((r) => Math.floor((n * r) / suma))
  let faltan = n - conteos.reduce((a, b) => a + b, 0)
  for (let i = filas - 1; faltan > 0; i = (i - 1 + filas) % filas, faltan--) conteos[i] += 1
  const asientos: Asiento[] = []
  radios.forEach((r, fi) => {
    const c = conteos[fi]
    for (let k = 0; k < c; k++) {
      const a = c === 1 ? Math.PI / 2 : Math.PI * (1 - k / (c - 1))
      asientos.push({ x: r * Math.cos(a), y: r * Math.sin(a), angulo: a })
    }
  })
  asientos.sort((p, q) => q.angulo - p.angulo || p.x * p.x + p.y * p.y - (q.x * q.x + q.y * q.y))
  const paso = (1 - interior) / filas
  const arcoMin = Math.min(...radios.map((r, i) => (Math.PI * r) / Math.max(conteos[i] - 1, 1)))
  return { asientos, radio: Math.min(paso, arcoMin) * 0.4 }
}

export function Hemicycle({ grupos, filas, resaltado, onResaltar, etiquetaCentro, subCentro, className }: Props) {
  const total = grupos.reduce((s, g) => s + g.curules, 0)
  const nFilas = filas ?? (total > 60 ? 7 : total > 30 ? 5 : 4)
  const { asientos, radio } = useMemo(() => disposicion(total, nFilas), [total, nFilas])
  const [local, setLocal] = useState<string | null>(null)
  const activo = resaltado ?? local

  const asignados = useMemo(() => {
    const out: { g: GrupoCurules; i: number }[] = []
    for (const g of grupos) for (let k = 0; k < g.curules; k++) out.push({ g, i: out.length })
    return out
  }, [grupos])

  const set = (id: string | null) => {
    setLocal(id)
    onResaltar?.(id)
  }
  const resumen = grupos.map((g) => `${g.label}: ${g.curules}`).join(', ')

  return (
    <svg
      viewBox={`-1.06 -1.08 2.12 ${subCentro ? 1.3 : 1.14}`}
      className={className}
      role="img"
      aria-label={`Composición de ${total} curules. ${resumen}`}
      onPointerLeave={() => set(null)}
    >
      <g transform="scale(1,-1)">
        {asignados.map(({ g, i }) => {
          const s = asientos[i]
          if (!s) return null
          const color = `var(--fam-${g.familia})`
          const tenue = activo !== null && activo !== g.id
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={radio}
              fill={g.oposicion ? 'var(--surface)' : color}
              stroke={g.oposicion ? 'var(--fam-oposicion)' : 'var(--surface)'}
              strokeWidth={g.oposicion ? radio * 0.32 : radio * 0.18}
              opacity={tenue ? 0.18 : 1}
              style={{ transition: 'fill 500ms ease, opacity 200ms ease' }}
              onPointerEnter={() => set(g.id)}
            >
              <title>{`${g.label} · ${g.curules} ${g.curules === 1 ? 'curul' : 'curules'}${g.oposicion ? ' (Estatuto de la Oposición)' : ''}`}</title>
            </circle>
          )
        })}
      </g>
      {etiquetaCentro && (
        <text x={0} y={-0.06} textAnchor="middle" className="fill-ink" style={{ fontSize: 0.24, fontWeight: 600 }}>
          {etiquetaCentro}
        </text>
      )}
      {subCentro && (
        <text x={0} y={0.17} textAnchor="middle" className="fill-muted" style={{ fontSize: 0.078 }}>
          {subCentro}
        </text>
      )}
    </svg>
  )
}
