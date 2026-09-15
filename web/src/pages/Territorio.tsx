import { useMemo, useState } from 'react'
import { FloatingTip, TipRow, type TipState } from '../components/Tooltip'
import { Callout, Card, CardTitle, Dot, SectionHeader, Segmented, famColor } from '../components/ui'
import { dec, pct, pp } from '../lib/format'
import type { Territorio as TT } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Modo = 'nivel' | 'cambio'
type EjeX = 'j' | 'm60'
const EJE: Record<EjeX, { label: string; coef: string }> = {
  j: { label: 'Votantes de 18 a 30 años', coef: 'jovenes_18_30' },
  m60: { label: 'Votantes de más de 60 años', coef: 'mayores_60' },
}

export default function Territorio() {
  const { familias, famPorId } = useMeta()
  const t = useJson<TT>('territorio.json')
  const [modo, setModo] = useState<Modo>('nivel')
  const [orden, setOrden] = useState<string>('participacion')
  const [tip, setTip] = useState<TipState | null>(null)

  const filas = useMemo(() => {
    const out = Object.entries(t.localidades).map(([cod, l]) => {
      const a = l.series.concejo_2019
      const b = l.series.concejo_2023
      return { cod, nombre: l.nombre, volatilidad: l.volatilidad ?? 0, a, b }
    })
    const val = (r: (typeof out)[number]) => {
      if (orden === 'nombre') return 0
      if (orden === 'participacion') return r.b?.participacion ?? 0
      if (orden === 'volatilidad') return r.volatilidad
      if (orden === 'blanco') return modo === 'nivel' ? r.b?.blanco ?? 0 : (r.b?.blanco ?? 0) - (r.a?.blanco ?? 0)
      const vb = r.b?.cuotas[orden] ?? 0
      return modo === 'nivel' ? vb : vb - (r.a?.cuotas[orden] ?? 0)
    }
    return orden === 'nombre' ? out.sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) : out.sort((x, y) => val(y) - val(x))
  }, [t, orden, modo])

  const maxCol = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of familias) m[f.id] = Math.max(...filas.map((r) => r.b?.cuotas[f.id] ?? 0))
    return m
  }, [filas, familias])
  const maxCambio = Math.max(...filas.flatMap((r) => familias.map((f) => Math.abs((r.b?.cuotas[f.id] ?? 0) - (r.a?.cuotas[f.id] ?? 0)))), 0.01)

  const celda = (famId: string, r: (typeof filas)[number]) => {
    const b = r.b?.cuotas[famId] ?? 0
    const a = r.a?.cuotas[famId] ?? 0
    if (modo === 'nivel') {
      const k = maxCol[famId] ? b / maxCol[famId] : 0
      return { bg: `color-mix(in oklab, var(--fam-${famId}) ${Math.round(8 + 52 * k)}%, var(--surface))`, txt: pct(b, 0) }
    }
    const d = b - a
    const k = Math.min(1, Math.abs(d) / maxCambio)
    const polo = d >= 0 ? 'var(--div-pos-3)' : 'var(--div-neg-3)'
    return { bg: `color-mix(in oklab, ${polo} ${Math.round(55 * k)}%, var(--div-mid))`, txt: pp(d, 0) }
  }

  return (
    <div>
      <SectionHeader
        eyebrow="Territorio y demografía"
        title="Veinte localidades, veinte Concejos distintos"
        lede="La misma elección se lee muy distinto en Chapinero que en Bosa. Aquí están la fuerza de cada familia por localidad, lo que cambió entre 2019 y 2023 y cómo se relaciona el voto con la edad de quienes votan en cada puesto."
      />

      <Card>
        <CardTitle
          title="Localidad × familia política"
          subtitle={modo === 'nivel' ? 'Cuota de votos válidos en 2023. Cada columna tiene su propia escala de intensidad.' : 'Diferencia 2019→2023 en puntos porcentuales: rojo sube, azul baja.'}
          right={<Segmented<Modo> label="Modo" value={modo} onChange={setModo} options={[{ value: 'nivel', label: '2023' }, { value: 'cambio', label: 'Cambio 2019→2023' }]} />}
        />
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[980px] border-separate border-spacing-[2px] text-[12px]">
            <thead>
              <tr>
                <Th activo={orden === 'nombre'} onClick={() => setOrden('nombre')} align="left">
                  Localidad
                </Th>
                {familias.map((f) => (
                  <Th key={f.id} activo={orden === f.id} onClick={() => setOrden(f.id)}>
                    <span className="flex flex-col items-center gap-1">
                      <Dot familia={f.id} size={8} />
                      <span className="leading-tight">{f.nombre_corto}</span>
                    </span>
                  </Th>
                ))}
                <Th activo={orden === 'blanco'} onClick={() => setOrden('blanco')}>
                  Blanco
                </Th>
                <Th activo={orden === 'participacion'} onClick={() => setOrden('participacion')}>
                  Participación
                </Th>
                <Th activo={orden === 'volatilidad'} onClick={() => setOrden('volatilidad')}>
                  Volatilidad
                </Th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr key={r.cod}>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-[13px] text-ink-2">{r.nombre}</td>
                  {familias.map((f) => {
                    const c = celda(f.id, r)
                    return (
                      <td
                        key={f.id}
                        className="rounded-md px-1 py-1.5 text-center text-ink"
                        style={{ background: c.bg }}
                        onPointerMove={(e) =>
                          setTip({
                            x: e.clientX,
                            y: e.clientY,
                            content: (
                              <div>
                                <p className="mb-1 font-semibold">
                                  {r.nombre} · {f.nombre_corto}
                                </p>
                                <TipRow color={famColor(f.id)} label="2023" value={pct(r.b?.cuotas[f.id] ?? 0)} strong />
                                <TipRow label="2019" value={pct(r.a?.cuotas[f.id] ?? 0)} />
                                <TipRow label="Cambio" value={pp((r.b?.cuotas[f.id] ?? 0) - (r.a?.cuotas[f.id] ?? 0))} />
                              </div>
                            ),
                          })
                        }
                        onPointerLeave={() => setTip(null)}
                      >
                        {c.txt}
                      </td>
                    )
                  })}
                  <td className="rounded-md bg-surface-2 px-1 py-1.5 text-center">
                    {modo === 'nivel' ? pct(r.b?.blanco ?? 0, 0) : pp((r.b?.blanco ?? 0) - (r.a?.blanco ?? 0), 0)}
                  </td>
                  <td className="rounded-md bg-surface-2 px-1 py-1.5 text-center">
                    {modo === 'nivel' ? pct(r.b?.participacion ?? 0, 0) : pp((r.b?.participacion ?? 0) - (r.a?.participacion ?? 0), 0)}
                  </td>
                  <td className="rounded-md bg-surface-2 px-1 py-1.5 text-center">{pct(r.volatilidad, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          Volatilidad: índice de Pedersen entre familias (porcentaje de votos que cambió de familia entre 2019 y 2023). Excluye el puesto censo de Corferias y los
          centros de reclusión. Toca un encabezado para ordenar.
        </p>
        <FloatingTip tip={tip} />
      </Card>

      <Card className="mt-5">
        <Demografia t={t} familias={familias} famPorId={famPorId} />
      </Card>
    </div>
  )
}

function Th({ children, activo, onClick, align = 'center' }: { children: React.ReactNode; activo: boolean; onClick: () => void; align?: 'left' | 'center' }) {
  return (
    <th className={`pb-2 align-bottom font-medium ${align === 'left' ? 'text-left' : 'text-center'}`}>
      <button type="button" onClick={onClick} className={`w-full ${align === 'left' ? 'text-left' : 'text-center'} ${activo ? 'text-ink underline underline-offset-4' : 'text-muted hover:text-ink'}`}>
        {children}
      </button>
    </th>
  )
}

function Demografia({ t, familias, famPorId }: { t: TT; familias: { id: string; nombre_corto: string }[]; famPorId: Record<string, { nombre_corto: string; nombre: string }> }) {
  const [fam, setFam] = useState('pacto_historico')
  const [eje, setEje] = useState<EjeX>('j')
  const [tip, setTip] = useState<TipState | null>(null)
  const d = t.demografia
  const pts = d.puntos.map((p) => ({ x: p[eje] as number, y: p[fam] as number, id: p.id }))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(...ys) * 1.05
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length
  const my = ys.reduce((s, v) => s + v, 0) / ys.length
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0)
  const syy = ys.reduce((s, v) => s + (v - my) ** 2, 0)
  const b = sxy / sxx
  const r = sxy / Math.sqrt(sxx * syy)
  const W = 560
  const H = 320
  const px = (v: number) => 40 + ((v - xMin) / (xMax - xMin)) * (W - 56)
  const py = (v: number) => H - 28 - (v / yMax) * (H - 44)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * yMax)

  return (
    <>
      <CardTitle
        title="Edad y voto por puesto"
        subtitle="Cada punto es un puesto de votación de 2023 con al menos 300 votos válidos. Es una relación ecológica: describe territorios, no personas."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={fam} onChange={(e) => setFam(e.target.value)} aria-label="Familia" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
          {familias.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre_corto}
            </option>
          ))}
        </select>
        <Segmented<EjeX> label="Eje horizontal" value={eje} onChange={setEje} options={[{ value: 'j', label: '18 a 30 años' }, { value: 'm60', label: 'Más de 60' }]} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <figure>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${famPorId[fam]?.nombre} frente a ${EJE[eje].label}: correlación ${dec(r, 2)}`}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={40} x2={W - 12} y1={py(v)} y2={py(v)} stroke="var(--hairline)" />
                <text x={34} y={py(v) + 3} textAnchor="end" className="fill-muted" style={{ fontSize: 10 }}>
                  {pct(v, 0)}
                </text>
              </g>
            ))}
            {pts.map((p) => (
              <circle key={p.id} cx={px(p.x)} cy={py(p.y)} r={3.2} fill={famColor(fam)} opacity={0.5} />
            ))}
            <line x1={px(xMin)} x2={px(xMax)} y1={py(my + b * (xMin - mx))} y2={py(my + b * (xMax - mx))} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
            {[xMin, (xMin + xMax) / 2, xMax].map((v) => (
              <text key={v} x={px(v)} y={H - 10} textAnchor="middle" className="fill-muted" style={{ fontSize: 10 }}>
                {pct(v, 0)}
              </text>
            ))}
            <rect
              x={40}
              y={0}
              width={W - 52}
              height={H - 28}
              fill="transparent"
              onPointerMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                const sx = ((e.clientX - rect.left) / rect.width) * W
                const sy = ((e.clientY - rect.top) / rect.height) * H
                let best = pts[0]
                let dist = Infinity
                for (const p of pts) {
                  const dd = (px(p.x) - sx) ** 2 + (py(p.y) - sy) ** 2
                  if (dd < dist) {
                    dist = dd
                    best = p
                  }
                }
                if (dist > 900) return setTip(null)
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  content: (
                    <div>
                      <p className="mb-1 font-semibold">Puesto {best.id}</p>
                      <TipRow color={famColor(fam)} label={famPorId[fam]?.nombre_corto} value={pct(best.y)} strong />
                      <TipRow label={EJE[eje].label} value={pct(best.x)} />
                    </div>
                  ),
                })
              }}
              onPointerLeave={() => setTip(null)}
            />
          </svg>
          <figcaption className="mt-1 text-center text-[12px] text-muted">{EJE[eje].label} (porcentaje del potencial del puesto)</figcaption>
        </figure>
        <div>
          <p className="text-[13px] text-muted">Correlación</p>
          <p className="text-[2.4rem] font-semibold leading-none tracking-tight">{dec(r, 2)}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Por cada 10 puntos más de {EJE[eje].label.toLowerCase().replace('votantes de ', 'votantes de ')}, la cuota de {famPorId[fam]?.nombre_corto} cambia {pp(b * 0.1)} en
            promedio (recta de mínimos cuadrados).
          </p>
          <p className="mt-6 eyebrow">Modelo conjunto por familia</p>
          <p className="mt-1 text-[12px] text-muted">Efecto de subir una desviación estándar cada variable, manteniendo las demás (MCO ponderado, errores robustos HC1).</p>
          <table className="tabular mt-3 w-full text-[12px]">
            <thead>
              <tr className="border-b border-hairline text-muted">
                <th className="py-1.5 text-left font-medium">Familia</th>
                <th className="py-1.5 text-right font-medium">18–30</th>
                <th className="py-1.5 text-right font-medium">60+</th>
                <th className="py-1.5 text-right font-medium">Mujeres</th>
                <th className="py-1.5 text-right font-medium">R²</th>
              </tr>
            </thead>
            <tbody>
              {familias.map((f) => {
                const m = d.modelos[f.id]
                if (!m) return null
                return (
                  <tr key={f.id} className={`border-b border-hairline last:border-0 ${f.id === fam ? 'bg-surface-2' : ''}`}>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Dot familia={f.id} size={7} />
                        {f.nombre_corto}
                      </span>
                    </td>
                    {(['jovenes_18_30', 'mayores_60', 'mujeres'] as const).map((k) => {
                      const c = m.coef[k]
                      const sig = Math.abs(c.b) > 1.96 * c.ee
                      return (
                        <td key={k} className={`py-1.5 text-right ${sig ? 'font-semibold text-ink' : 'text-muted'}`}>
                          {pp(c.b)}
                          {sig ? '' : '*'}
                        </td>
                      )
                    })}
                    <td className="py-1.5 text-right text-ink-2">{dec(m.r2, 2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">* No significativo al 95 %. n = {d.n_puestos} puestos.</p>
        </div>
      </div>
      <div className="mt-5">
        <Callout title="Falacia ecológica">
          Que un partido tenga más votos donde viven más jóvenes no significa que los jóvenes voten por ese partido: la edad se correlaciona con ingreso, estrato y
          tipo de barrio. Úsalo para leer territorios, no para perfilar votantes.
        </Callout>
      </div>
      <FloatingTip tip={tip} />
    </>
  )
}
