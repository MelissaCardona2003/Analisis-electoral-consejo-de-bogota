import * as Slider from '@radix-ui/react-slider'
import { useMemo, useState } from 'react'
import { Hemicycle, type GrupoCurules } from '../components/Hemicycle'
import { FloatingTip, TipRow, type TipState } from '../components/Tooltip'
import { Callout, Card, CardTitle, Dot, SectionHeader, Segmented, TablaToggle, famColor } from '../components/ui'
import { dec, num, pct } from '../lib/format'
import type { Familia, ListaResultado, ResultadoAnio, Resultados as TRes } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Anio = '2019' | '2023'
const miles = (v: number) => (v / 1000).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function Resultados() {
  const { familias, famPorId } = useMeta()
  const res = useJson<TRes>('resultados.json')
  const [anio, setAnio] = useState<Anio>('2023')
  const [activo, setActivo] = useState<string | null>(null)
  const d = res[anio]
  const c = d.ciudad
  const orden = useMemo(() => Object.fromEntries(familias.map((f) => [f.id, f.orden])), [familias])
  const listas = d.listas.filter((l) => !l.sin_lista)

  const grupos = useMemo<GrupoCurules[]>(() => {
    const out: GrupoCurules[] = []
    const conCurul = d.listas
      .filter((l) => l.curules > 0 || l.oposicion)
      .sort((a, b) => orden[a.familia] - orden[b.familia] || b.votos - a.votos)
    for (const l of conCurul) {
      if (l.curules) out.push({ id: l.id, label: l.nombre, familia: l.familia, curules: l.curules })
      if (l.oposicion) out.push({ id: l.id, label: `${l.nombre} · curul de oposición`, familia: l.familia, curules: 1, oposicion: true })
    }
    return out
  }, [d, orden])

  return (
    <div>
      <SectionHeader
        eyebrow="Resultados oficiales · escrutinio"
        title={`El Concejo que eligió Bogotá en ${anio}`}
        lede="Votos por lista, curules y la mecánica completa del reparto: umbral, cociente y cifra repartidora. El motor de cálculo reproduce exactamente la composición oficial de 2011, 2015, 2019 y 2023."
      >
        <Segmented<Anio> label="Año" value={anio} onChange={setAnio} options={[{ value: '2019', label: '2019' }, { value: '2023', label: '2023' }]} />
      </SectionHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Mini label="Potencial electoral" value={num(c.potencial)} />
        <Mini label="Votantes" value={num(c.votantes)} sub={`${pct(c.participacion)} de participación`} />
        <Mini label="Votos válidos" value={num(c.validos)} sub={`incluye ${num(c.blanco)} en blanco`} />
        <Mini label="Umbral" value={num(d.umbral)} sub="50 % del cociente" />
        <Mini label="Cifra repartidora" value={num(d.cifra_repartidora)} sub="votos por curul" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardTitle title="Curules por lista" subtitle="Ordenadas por familia política. El anillo es la curul del Estatuto de la Oposición." />
          <Hemicycle grupos={grupos} resaltado={activo} onResaltar={setActivo} etiquetaCentro="45" subCentro="curules" className="mx-auto w-full max-w-[460px]" />
          <ul className="mt-5 grid gap-x-4 gap-y-1.5 border-t border-hairline pt-4 sm:grid-cols-2">
            {grupos.map((g, i) => (
              <li
                key={`${g.id}-${i}`}
                onPointerEnter={() => setActivo(g.id)}
                onPointerLeave={() => setActivo(null)}
                className={`flex items-center justify-between gap-2 text-[13px] transition-opacity ${activo && activo !== g.id ? 'opacity-40' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Dot familia={g.familia} size={9} ring={g.oposicion} />
                  <span className="truncate text-ink-2">{g.label}</span>
                </span>
                <span className="tabular font-semibold">{g.curules}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-7">
          <BarrasListas listas={listas} d={d} famPorId={famPorId} />
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle
          title="Cómo se reparten las 44 curules"
          subtitle="La cifra repartidora (método D'Hondt) divide la votación de cada lista por 1, 2, 3… y entrega las curules a los 44 cocientes más altos."
        />
        <Repartidora d={d} />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <UltimaCurul listas={listas} />
        </Card>
        <Card>
          <CardTitle title="Cómo se votó" subtitle="Voto preferente (por un candidato) frente a voto solo por la lista, y votos que no cuentan." />
          <div className="space-y-4">
            <Proporcion
              partes={[
                { label: 'Voto por candidato', v: listas.reduce((s, l) => s + l.votos_candidato, 0), color: 'var(--ink)' },
                { label: 'Voto solo por lista', v: listas.reduce((s, l) => s + l.votos_lista, 0), color: 'var(--axis)' },
              ]}
            />
            <Proporcion
              partes={[
                { label: 'Votos por listas', v: c.votos_listas, color: 'var(--ink)' },
                { label: 'En blanco', v: c.blanco, color: 'var(--fam-blanco)' },
                { label: 'Nulos', v: c.nulo, color: 'var(--critical)' },
                { label: 'No marcados', v: c.no_marcado, color: 'var(--axis)' },
              ]}
            />
            <Callout>
              En {anio}, {pct(c.pct_nulo)} de los votantes anuló su voto y {pct(c.pct_no_marcado)} dejó el tarjetón sin marcar: {num(c.nulo + c.no_marcado)} votos
              que no cuentan para el cociente. El voto en blanco sí cuenta y eleva el umbral.
            </Callout>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle title="Cuatro elecciones: 2011–2023" subtitle="Cuota de votos válidos de cada familia política y curules obtenidas (con la de oposición)." />
        <Evolucion hist={res.historico_familias} familias={familias} />
      </Card>
    </div>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-2">{sub}</p>}
    </div>
  )
}

function BarrasListas({ listas, d, famPorId }: { listas: ListaResultado[]; d: ResultadoAnio; famPorId: Record<string, Familia> }) {
  const [tip, setTip] = useState<TipState | null>(null)
  const [tabla, setTabla] = useState(false)
  const max = Math.max(...listas.map((l) => l.pct)) * 1.28
  const umbralPct = d.umbral / d.ciudad.validos
  const x = (v: number) => `${(v / max) * 100}%`

  return (
    <>
      <CardTitle
        title="Votos y curules por lista"
        subtitle={`Porcentaje de votos válidos. La línea vertical marca el umbral (${pct(umbralPct, 2)}).`}
        right={<TablaToggle abierta={tabla} onToggle={() => setTabla(!tabla)} />}
      />
      {tabla ? (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12px] text-muted">
                <th className="py-2 font-medium">Lista</th>
                <th className="py-2 text-right font-medium">Votos</th>
                <th className="py-2 text-right font-medium">% válidos</th>
                <th className="py-2 text-right font-medium">Voto preferente</th>
                <th className="py-2 text-right font-medium">Curules</th>
                <th className="py-2 text-right font-medium">Faltaron para otra</th>
              </tr>
            </thead>
            <tbody>
              {listas.map((l) => (
                <tr key={l.id} className="border-b border-hairline last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <Dot familia={l.familia} size={8} />
                      {l.nombre}
                    </span>
                  </td>
                  <td className="py-2 text-right">{num(l.votos)}</td>
                  <td className="py-2 text-right">{pct(l.pct, 2)}</td>
                  <td className="py-2 text-right">{l.votos ? pct(l.votos_candidato / l.votos, 0) : '–'}</td>
                  <td className="py-2 text-right font-semibold">{l.curules + l.oposicion}</td>
                  <td className="py-2 text-right">{num(l.faltan_para_otra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {listas.map((l) => (
            <li
              key={l.id}
              className="grid cursor-default grid-cols-[minmax(0,10.5rem)_1fr_1.75rem] items-center gap-3 rounded-lg px-1 py-1 hover:bg-surface-2"
              onPointerMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  content: (
                    <div>
                      <p className="mb-1.5 font-semibold">{l.nombre}</p>
                      <TipRow label="Votos" value={num(l.votos)} strong />
                      <TipRow label="% de válidos" value={pct(l.pct, 2)} />
                      <TipRow label="Curules" value={l.curules} />
                      <TipRow label="Familia" value={famPorId[l.familia]?.nombre_corto} />
                      {l.supera_umbral ? (
                        <TipRow label="Le faltaron para otra curul" value={num(l.faltan_para_otra)} />
                      ) : (
                        <TipRow label="No superó el umbral por" value={num(d.umbral - l.votos)} />
                      )}
                    </div>
                  ),
                })
              }
              onPointerLeave={() => setTip(null)}
            >
              <span className={`flex min-w-0 items-center gap-2 text-[13px] ${l.supera_umbral ? 'text-ink-2' : 'text-muted'}`}>
                <Dot familia={l.familia} size={8} />
                <span className="truncate">{l.nombre}</span>
              </span>
              <span className="relative h-6">
                <span
                  className="absolute top-[6px] bottom-[6px] left-0 rounded-r-[4px]"
                  style={{ width: x(l.pct), background: famColor(l.familia), opacity: l.supera_umbral ? 1 : 0.35 }}
                />
                <span className="absolute top-0 bottom-0 w-px bg-ink-2/60" style={{ left: x(umbralPct) }} />
                <span className="tabular absolute top-1/2 -translate-y-1/2 pl-1.5 text-[12px] text-ink-2" style={{ left: x(l.pct) }}>
                  {pct(l.pct)}
                </span>
              </span>
              <span className="tabular text-right text-[13px] font-semibold">{l.curules || <span className="text-muted">–</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <FloatingTip tip={tip} />
    </>
  )
}

function Repartidora({ d }: { d: ResultadoAnio }) {
  const [paso, setPaso] = useState(44)
  const info = useMemo(() => Object.fromEntries(d.listas.map((l) => [l.id, l])), [d])
  const ranking = useMemo(() => {
    const todos = d.cocientes.flatMap((l) => l.q.map((q, i) => ({ id: l.id, div: i + 1, q })))
    todos.sort((a, b) => b.q - a.q)
    return { todos, pos: new Map(todos.map((t, i) => [`${t.id}-${t.div}`, i + 1])) }
  }, [d])
  const actual = ranking.todos[paso - 1]
  const siguiente = ranking.todos[44]
  const excluidas = d.listas.filter((l) => !l.supera_umbral && !l.sin_lista)
  const asignadas = (id: string) => d.cocientes.find((c) => c.id === id)!.q.filter((_, i) => (ranking.pos.get(`${id}-${i + 1}`) ?? 99) <= paso).length

  return (
    <div>
      <ol className="grid gap-4 md:grid-cols-3">
        <Paso n={1} titulo="Cociente electoral">
          {num(d.ciudad.validos)} votos válidos ÷ 44 curules = <strong className="text-ink">{num(d.cociente)}</strong>
        </Paso>
        <Paso n={2} titulo="Umbral">
          La mitad del cociente: <strong className="text-ink">{num(d.umbral)}</strong> votos. {excluidas.length} listas no lo alcanzaron
          {excluidas.length ? ` (${excluidas.map((l) => l.nombre).join(', ')})` : ''} y quedan fuera del reparto.
        </Paso>
        <Paso n={3} titulo="Cifra repartidora">
          El cociente n.º 44 fue <strong className="text-ink">{num(d.cifra_repartidora)}</strong>. Cada lista gana una curul por cada vez que su votación contiene esa cifra.
        </Paso>
      </ol>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 md:flex-row md:items-center md:gap-6">
        <label htmlFor="paso" className="shrink-0 text-[13px] font-medium text-ink-2">
          Curul n.º <span className="tabular text-ink">{paso}</span>
        </label>
        <Slider.Root id="paso" className="relative flex h-5 flex-1 touch-none select-none items-center" min={1} max={44} step={1} value={[paso]} onValueChange={([v]) => setPaso(v)} aria-label="Número de curul">
          <Slider.Track className="relative h-1 grow rounded-full bg-[var(--hairline)]">
            <Slider.Range className="absolute h-full rounded-full bg-ink" />
          </Slider.Track>
          <Slider.Thumb className="block size-4 rounded-full border-2 border-ink bg-surface shadow focus-visible:outline-2" />
        </Slider.Root>
        <p className="text-[13px] text-ink-2 md:w-[46%]">
          Se asigna a <strong className="text-ink">{info[actual.id]?.nombre}</strong> con {num(actual.q)} votos (su votación ÷ {actual.div}).
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="tabular w-full min-w-[820px] border-separate border-spacing-[2px] text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="sticky left-0 z-10 bg-surface py-1 pr-3 text-left font-medium">Lista · votos en miles</th>
              {Array.from({ length: 13 }, (_, i) => (
                <th key={i} className="py-1 font-medium">
                  ÷{i + 1}
                </th>
              ))}
              <th className="py-1 pl-2 text-right font-medium">Curules</th>
            </tr>
          </thead>
          <tbody>
            {d.cocientes.map((l) => (
              <tr key={l.id}>
                <td className="sticky left-0 z-10 bg-surface py-1 pr-3">
                  <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                    <Dot familia={info[l.id]?.familia ?? 'otros'} size={8} />
                    {info[l.id]?.nombre}
                  </span>
                </td>
                {l.q.map((q, i) => {
                  const r = ranking.pos.get(`${l.id}-${i + 1}`) ?? 999
                  const gana = r <= paso
                  const es = r === paso
                  return (
                    <td
                      key={i}
                      title={`Cociente n.º ${r}`}
                      className={`rounded-md px-1.5 py-1.5 text-center transition-colors ${es ? 'ring-2 ring-ink' : ''} ${r > 44 ? 'text-muted' : 'text-ink'}`}
                      style={{ background: gana ? `color-mix(in oklab, var(--fam-${info[l.id]?.familia}) 26%, var(--surface))` : 'var(--surface-2)' }}
                    >
                      {miles(q)}
                    </td>
                  )
                })}
                <td className="py-1 pl-2 text-right font-semibold">{asignadas(l.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {siguiente && (
        <p className="mt-3 text-[13px] text-muted">
          El cociente n.º 45 —el primero sin curul— fue de {info[siguiente.id]?.nombre} con {num(siguiente.q)} votos: le faltaron{' '}
          {num(d.cifra_repartidora - siguiente.q + 1)} votos.
        </p>
      )}
    </div>
  )
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-hairline p-4">
      <span className="tabular text-xs font-semibold text-muted">Paso {n}</span>
      <p className="mt-1 font-semibold tracking-tight">{titulo}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</p>
    </li>
  )
}

function UltimaCurul({ listas }: { listas: ListaResultado[] }) {
  const cerca = listas.filter((l) => l.supera_umbral).sort((a, b) => a.faltan_para_otra - b.faltan_para_otra).slice(0, 5)
  const fragiles = listas.filter((l) => l.curules > 0).sort((a, b) => a.colchon - b.colchon).slice(0, 5)
  const maxF = Math.max(...cerca.map((l) => l.faltan_para_otra), ...fragiles.map((l) => l.colchon))
  const Fila = ({ l, v }: { l: ListaResultado; v: number }) => (
    <li className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 py-1.5 text-[13px]">
      <span className="flex min-w-0 items-center gap-2 text-ink-2">
        <Dot familia={l.familia} size={8} />
        <span className="truncate">{l.nombre}</span>
      </span>
      <span className="h-1.5 rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max((v / maxF) * 100, 2)}%` }} />
      </span>
      <span className="tabular text-right">{num(v)}</span>
    </li>
  )
  return (
    <>
      <CardTitle title="La última curul" subtitle="Votos que le faltaron a cada lista para una curul más, y margen con el que retuvo la última." />
      <p className="eyebrow mb-1">A un paso de otra curul</p>
      <ul>{cerca.map((l) => <Fila key={l.id} l={l} v={l.faltan_para_otra} />)}</ul>
      <p className="eyebrow mb-1 mt-5">Curules más frágiles</p>
      <ul>{fragiles.map((l) => <Fila key={l.id} l={l} v={l.colchon} />)}</ul>
    </>
  )
}

function Proporcion({ partes }: { partes: { label: string; v: number; color: string }[] }) {
  const tot = partes.reduce((s, p) => s + p.v, 0)
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {partes.map((p) => (
          <span key={p.label} style={{ width: `${(p.v / tot) * 100}%`, background: p.color }} title={`${p.label}: ${pct(p.v / tot)}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {partes.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="tabular text-ink">{pct(p.v / tot)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Evolucion({ hist, familias }: { hist: TRes['historico_familias']; familias: Familia[] }) {
  const anios = ['2011', '2015', '2019', '2023']
  const [tip, setTip] = useState<TipState | null>(null)
  const max = Math.max(...anios.flatMap((a) => familias.map((f) => hist[a]?.[f.id]?.cuota ?? 0)), 0.2)
  const X = (i: number) => 18 + i * 54
  const Y = (v: number) => 62 - (v / max) * 52
  return (
    <>
      <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {familias.map((f) => {
          const pts = anios.map((a, i) => ({ a, i, v: hist[a]?.[f.id]?.cuota ?? 0, c: hist[a]?.[f.id]?.curules ?? 0 }))
          const vivos = pts.filter((p) => p.v > 0)
          const ult = pts[pts.length - 1]
          return (
            <figure key={f.id} className="min-w-0">
              <figcaption className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  <Dot familia={f.id} size={8} />
                  <span className="truncate font-medium">{f.nombre_corto}</span>
                </span>
                <span className="tabular text-ink-2">{pct(ult.v)}</span>
              </figcaption>
              <svg viewBox="0 0 200 84" className="mt-1 w-full" role="img" aria-label={`${f.nombre}: ${pts.map((p) => `${p.a} ${pct(p.v)}`).join(', ')}`}>
                <line x1={10} x2={190} y1={62} y2={62} stroke="var(--hairline)" />
                <polyline points={vivos.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" stroke={famColor(f.id)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p) => (
                  <g key={p.a}>
                    <circle
                      cx={X(p.i)}
                      cy={Y(p.v)}
                      r={p.v > 0 ? 4 : 3}
                      fill={p.v > 0 ? famColor(f.id) : 'var(--surface)'}
                      stroke={p.v > 0 ? 'var(--surface)' : 'var(--axis)'}
                      strokeWidth={2}
                    />
                    <rect
                      x={X(p.i) - 14}
                      y={0}
                      width={28}
                      height={84}
                      fill="transparent"
                      onPointerMove={(e) =>
                        setTip({
                          x: e.clientX,
                          y: e.clientY,
                          content: (
                            <div>
                              <p className="mb-1 font-semibold">
                                {f.nombre_corto} · {p.a}
                              </p>
                              <TipRow color={famColor(f.id)} label="Votos válidos" value={p.v ? pct(p.v) : 'sin lista'} strong />
                              <TipRow label="Curules" value={p.c} />
                            </div>
                          ),
                        })
                      }
                      onPointerLeave={() => setTip(null)}
                    />
                    <text x={X(p.i)} y={78} textAnchor="middle" className="fill-muted" style={{ fontSize: 10 }}>
                      ’{p.a.slice(2)} · {p.c}
                    </text>
                  </g>
                ))}
              </svg>
            </figure>
          )
        })}
      </div>
      <p className="mt-4 text-[12px] text-muted">
        Etiqueta inferior: año · curules. 2011 y 2015: totales publicados; 2019 y 2023: escrutinio mesa a mesa. Blanco 2023: {pct(hist['2023'].blanco.cuota)}.
        Escala común hasta {dec(max * 100, 0)} %.
      </p>
      <FloatingTip tip={tip} />
    </>
  )
}
