import { Check, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { FloatingTip, TipRow, type TipState } from '../components/Tooltip'
import { Callout, Card, CardTitle, Dot, SectionHeader, StatTile, famColor } from '../components/ui'
import { compact, dec, num, pct } from '../lib/format'
import type { DistCurules, EscenariosIAOut, Familia, Meta, Pronostico as TP, Simulaciones } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

const NOMBRE_ESCENARIO: Record<string, string> = {
  persistencia: 'Persistencia',
  swing_uniforme: 'Swing uniforme de Cámara 2026',
  transferencia: 'Transferencia desde Cámara (κ)',
  transferencia_matriz: 'Matriz de transferencia (inferencia ecológica)',
  sin_lista_de_oviedo: 'Sin La Lista de Oviedo',
}

export default function Pronostico() {
  const { familias, famPorId, meta } = useMeta()
  const pro = useJson<TP>('pronostico.json')
  const sims = useJson<Simulaciones>('simulaciones.json')
  const escenariosIA = useJson<EscenariosIAOut>('escenarios_ia.json')
  const p = pro.pronostico
  const fams = [...p.familias].sort((a, b) => b.curules.media - a.curules.media)
  const K = Math.max(...p.familias.map((f) => Math.ceil(f.curules.p975))) + 2
  const part = pro.participacion
  const fecha = new Date(pro.generado).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      <SectionHeader
        eyebrow={`Pronóstico probabilístico · actualizado el ${fecha}`}
        title="Concejo de Bogotá 2027: lo probable y lo posible"
        lede={
          <>
            {pro.n_simulaciones.toLocaleString('es-CO')} simulaciones de la elección combinan la votación de 2023, la volatilidad histórica del Concejo
            (2011–2023, con colas pesadas) y la irrupción de movimientos nuevos medida en la Cámara 2026. Cada simulación aplica el umbral y la cifra
            repartidora a 44 curules. Los rangos importan más que las medianas.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fams.map((f) => (
          <FamiliaCard key={f.id} f={f} fam={famPorId[f.id]} K={K} />
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <Coalicion sims={sims} familias={familias} meta={meta} />
        </Card>
        <Card className="lg:col-span-5">
          <CardTitle title="Participación esperada" subtitle="Censo proyectado a octubre de 2027 y participación simulada entre los niveles de 2019 y 2023." />
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Potencial electoral" value={compact(part.potencial_2027)} detail={`${pct(part.crecimiento_anual, 1)} anual`} />
            <StatTile label="Participación" value={pct(part.participacion.p50, 0)} detail={`${pct(part.participacion.p10, 0)}–${pct(part.participacion.p90, 0)}`} />
            <StatTile label="Votos válidos" value={compact(part.validos.p50)} detail={`${compact(part.validos.p10)}–${compact(part.validos.p90)}`} />
            <StatTile label="Umbral" value={num(Math.round(part.umbral_votos.p50 / 100) * 100)} detail="votos (mediana)" />
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            La participación no cambia el reparto de curules —el método es proporcional— pero fija cuántos votos cuesta cada curul: unos{' '}
            {num(Math.round(part.cociente_votos.p50 / 100) * 100)} por cociente.
          </p>
        </Card>
      </div>

      <Card className="mt-5">
        <TablaListas p={p} famPorId={famPorId} />
      </Card>

      <Card className="mt-5">
        <Escenarios p={p} familias={familias} />
      </Card>

      {Object.keys(escenariosIA).length > 0 && (
        <Card className="mt-5">
          <EscenariosIA escenarios={escenariosIA} p={p} familias={familias} />
        </Card>
      )}

      <Card className="mt-5">
        <Backtest pro={pro} famPorId={famPorId} familias={familias} />
      </Card>

      <Card className="mt-5">
        <CardTitle title="Supuestos y límites" />
        <ul className="grid gap-x-8 gap-y-3 text-[14px] leading-relaxed text-ink-2 md:grid-cols-2">
          <li>
            <strong className="text-ink">Listas de 2023.</strong> Se asume que las familias mantienen sus coaliciones de 2023. Las listas definitivas se conocerán al
            cierre de inscripciones (julio de 2027); el simulador permite explorar otras configuraciones.
          </li>
          <li>
            <strong className="text-ink">Movimientos nuevos.</strong> La Lista de Oviedo se proyecta desde su {pct(p.emergente.cuota_base)} en Cámara 2026 con la tasa de
            conversión Cámara→Concejo observada en 2022–2023 (mediana ×{dec(p.conversion_camara_concejo.mediana, 2)}).
          </li>
          <li>
            <strong className="text-ink">Curul de oposición.</strong> La curul 45 corresponde a quien quede de segundo en la Alcaldía y no se modela: las probabilidades de
            mayoría se calculan sobre las 44 curules de la cifra repartidora.
          </li>
          <li>
            <strong className="text-ink">Sin encuestas.</strong> El modelo solo usa resultados oficiales. No incorpora encuestas, candidaturas a la Alcaldía ni eventos
            posteriores a septiembre de 2026.
          </li>
        </ul>
      </Card>
    </div>
  )
}

function FamiliaCard({ f, fam, K }: { f: TP['pronostico']['familias'][number]; fam?: Familia; K: number }) {
  const c = f.curules
  return (
    <article className="card flex flex-col p-5">
      <header className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Dot familia={f.id} size={10} />
          <span className="truncate font-semibold tracking-tight">{fam?.nombre_corto}</span>
        </span>
        <span className="shrink-0 text-right text-[12px] text-muted">
          Mayor bancada
          <span className="tabular block text-[13px] font-semibold text-ink">{pct(f.p_mayor_bancada, 0)}</span>
        </span>
      </header>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[2.6rem] font-semibold leading-none tracking-tight">{Math.round(c.p50)}</span>
        <span className="text-sm text-ink-2">curules</span>
        <span className="ml-auto text-[13px] text-muted">
          80 %: <span className="tabular text-ink">{Math.round(c.p10)}–{Math.round(c.p90)}</span>
        </span>
      </div>
      <HistCurules c={c} familia={f.id} K={K} referencia={f.curules_2023} />
      <p className="mt-3 border-t border-hairline pt-3 text-[12px] leading-relaxed text-muted">
        Votos: <span className="tabular text-ink-2">{pct(f.cuota.p50)}</span> ({pct(f.cuota.p10)}–{pct(f.cuota.p90)}) · 2023: {pct(f.cuota_2023)} y{' '}
        {f.curules_2023} curules
      </p>
    </article>
  )
}

function HistCurules({ c, familia, K, referencia }: { c: DistCurules; familia: string; K: number; referencia?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const h = c.hist.slice(0, K + 1)
  const maxP = Math.max(...h)
  const mover = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const k = Math.min(K, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * (K + 1))))
    setHover(k)
    setTip({
      x: e.clientX,
      y: e.clientY,
      content: (
        <div>
          <TipRow color={famColor(familia)} label={`${k} curul${k === 1 ? '' : 'es'}`} value={pct(h[k] ?? 0, 1)} strong />
          <TipRow label={`${k} o más`} value={pct(c.hist.slice(k).reduce((s, v) => s + v, 0), 0)} />
        </div>
      ),
    })
  }
  return (
    <div className="mt-4">
      <svg
        ref={ref}
        viewBox={`0 0 ${(K + 1) * 10} 48`}
        className="h-16 w-full touch-none"
        role="img"
        aria-label={`Distribución de curules: mediana ${Math.round(c.p50)}, 80 % entre ${Math.round(c.p10)} y ${Math.round(c.p90)}`}
        onPointerMove={mover}
        onPointerLeave={() => {
          setTip(null)
          setHover(null)
        }}
      >
        <line x1={0} x2={(K + 1) * 10} y1={46} y2={46} stroke="var(--axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {h.map((v, k) => {
          const alto = maxP ? (v / maxP) * 42 : 0
          const dentro = k >= Math.floor(c.p10) && k <= Math.ceil(c.p90)
          return (
            <rect
              key={k}
              x={k * 10 + 1.5}
              y={46 - alto}
              width={7}
              height={alto}
              rx={1.5}
              fill={famColor(familia)}
              opacity={hover === k ? 1 : dentro ? 0.9 : 0.3}
            />
          )
        })}
        {referencia !== undefined && referencia <= K && (
          <circle cx={referencia * 10 + 5} cy={46} r={3} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
        )}
      </svg>
      <div className="relative mt-1 h-3 text-[10px] text-muted" aria-hidden="true">
        {Array.from({ length: Math.floor(K / 5) + 1 }, (_, i) => i * 5).map((t) => (
          <span key={t} className="tabular absolute -translate-x-1/2" style={{ left: `${((t + 0.5) / (K + 1)) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <FloatingTip tip={tip} />
    </div>
  )
}

function Coalicion({ sims, familias, meta }: { sims: Simulaciones; familias: Familia[]; meta: Meta }) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const totales = useMemo(() => {
    const js = sims.listas.map((id, j) => ({ j, f: meta.listas[id]?.familia })).filter((x) => x.f && sel.has(x.f)).map((x) => x.j)
    return sims.curules.map((fila) => js.reduce((s, j) => s + fila[j], 0))
  }, [sel, sims, meta])
  const n = totales.length
  const hist = Array.from({ length: 45 }, (_, k) => totales.filter((t) => t === k).length / n)
  const p23 = totales.filter((t) => t >= 23).length / n
  const ord = [...totales].sort((a, b) => a - b)
  const med = ord[Math.floor(n / 2)]
  const maxH = Math.max(...hist, 0.01)
  const toggle = (id: string) => {
    const s = new Set(sel)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSel(s)
  }

  return (
    <>
      <CardTitle title="Arma una coalición" subtitle="Elige familias y mira en cuántas simulaciones suman mayoría: 23 de las 44 curules de la cifra repartidora." />
      <div className="flex flex-wrap gap-2">
        {familias.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={sel.has(f.id)}
            onClick={() => toggle(f.id)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              sel.has(f.id) ? 'border-ink bg-ink text-plane' : 'border-hairline text-ink-2 hover:border-axis'
            }`}
          >
            <Dot familia={f.id} size={8} />
            {f.nombre_corto}
          </button>
        ))}
      </div>
      <div className="mt-6 grid items-end gap-6 md:grid-cols-[auto_1fr]">
        <div>
          <p className="text-[13px] text-muted">Probabilidad de mayoría</p>
          <p className="text-[3.2rem] font-semibold leading-none tracking-tight">{sel.size ? pct(p23, 0) : '—'}</p>
          <p className="mt-1 text-[13px] text-ink-2">{sel.size ? `Mediana: ${med} curules` : 'Selecciona al menos una familia'}</p>
        </div>
        <svg viewBox="0 0 450 90" className="w-full" role="img" aria-label="Distribución de curules de la coalición">
          {hist.map((v, k) => (
            <rect key={k} x={k * 10 + 1} y={78 - (v / maxH) * 70} width={8} height={(v / maxH) * 70} rx={1.5} fill={k >= 23 ? 'var(--ink)' : 'var(--axis)'} />
          ))}
          <line x1={230} x2={230} y1={0} y2={80} stroke="var(--critical)" strokeWidth={1.5} />
          <text x={234} y={10} className="fill-ink-2" style={{ fontSize: 11 }}>
            mayoría (23)
          </text>
          {[0, 10, 20, 30, 40].map((t) => (
            <text key={t} x={t * 10 + 5} y={89} textAnchor="middle" className="fill-muted" style={{ fontSize: 10 }}>
              {t}
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-3 text-[12px] text-muted">Calculado sobre {n.toLocaleString('es-CO')} simulaciones de la muestra. No asume acuerdos reales entre partidos.</p>
    </>
  )
}

function TablaListas({ p, famPorId }: { p: TP['pronostico']; famPorId: Record<string, Familia> }) {
  const filas = [...p.listas].sort((a, b) => b.cuota.p50 - a.cuota.p50)
  return (
    <>
      <CardTitle title="Listas" subtitle="Cuota de votos válidos y curules por lista. La probabilidad de superar el umbral decide la supervivencia de las listas pequeñas." />
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[680px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[12px] text-muted">
              <th className="py-2 font-medium">Lista</th>
              <th className="py-2 text-right font-medium">Votos (mediana)</th>
              <th className="py-2 text-right font-medium">80 % de escenarios</th>
              <th className="py-2 text-right font-medium">Curules</th>
              <th className="py-2 text-right font-medium">80 %</th>
              <th className="py-2 text-right font-medium">Supera umbral</th>
              <th className="py-2 text-right font-medium">2023</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => (
              <tr key={l.id} className="border-b border-hairline last:border-0">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <Dot familia={l.familia} size={8} />
                    <span>{l.nombre}</span>
                    <span className="hidden text-muted lg:inline">· {famPorId[l.familia]?.nombre_corto}</span>
                  </span>
                </td>
                <td className="py-2 text-right">{pct(l.cuota.p50)}</td>
                <td className="py-2 text-right text-ink-2">
                  {pct(l.cuota.p10)}–{pct(l.cuota.p90)}
                </td>
                <td className="py-2 text-right font-semibold">{Math.round(l.curules.p50)}</td>
                <td className="py-2 text-right text-ink-2">
                  {Math.round(l.curules.p10)}–{Math.round(l.curules.p90)}
                </td>
                <td className="py-2 text-right">{pct(l.p_umbral, 0)}</td>
                <td className="py-2 text-right text-muted">{l.id === 'con_toda_por_bogota' ? 'nueva' : l.curules_2023}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Escenarios({ p, familias }: { p: TP['pronostico']; familias: Familia[] }) {
  const claves = Object.keys(p.escenarios)
  const central = Object.fromEntries(p.familias.map((f) => [f.id, f.curules]))
  return (
    <>
      <CardTitle
        title="¿Y si…? Escenarios alternativos"
        subtitle={`Curules medianas por familia bajo otras reglas. El escenario central (${p.nombre_regla.toLowerCase()}) fue el de menor error en el backtest.`}
      />
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[12px] text-muted">
              <th className="py-2 font-medium">Familia</th>
              <th className="py-2 text-right font-medium text-ink">Central</th>
              {claves.map((k) => (
                <th key={k} className="py-2 text-right font-medium">
                  {NOMBRE_ESCENARIO[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {familias.map((f) => {
              const base = Math.round(central[f.id]?.p50 ?? 0)
              return (
                <tr key={f.id} className="border-b border-hairline last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <Dot familia={f.id} size={8} />
                      {f.nombre_corto}
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold">{base}</td>
                  {claves.map((k) => {
                    const v = Math.round(p.escenarios[k][f.id]?.p50 ?? 0)
                    const d = v - base
                    return (
                      <td key={k} className="py-2 text-right">
                        {v}
                        <span className={`ml-1.5 inline-block w-7 text-left text-[11px] ${d > 0 ? 'text-good' : d < 0 ? 'text-critical' : 'text-muted'}`}>
                          {d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '·'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Callout title="Cómo leerlo">
        El swing uniforme traslada al Concejo el cambio de cada familia en la Cámara entre 2022 y 2026; la transferencia aplica el coeficiente κ ={' '}
        {dec(p.kappa.kappa_mco, 2)} estimado entre 2018/2022 y 2019/2023. Ambos reflejan la ola del Centro Democrático y de Salvación Nacional en 2026, pero al
        proyectar 2023 fallaron más que la persistencia: el voto al Concejo depende de redes locales y candidaturas que la Cámara no captura.
      </Callout>
    </>
  )
}

function EscenariosIA({
  escenarios,
  p,
  familias,
}: {
  escenarios: EscenariosIAOut
  p: TP['pronostico']
  familias: Familia[]
}) {
  const central = Object.fromEntries(p.familias.map((f) => [f.id, f.curules]))
  return (
    <>
      <CardTitle
        title="Escenarios con hipótesis"
        subtitle="Hipótesis políticas externas traducidas a parámetros del motor y simuladas con el mismo Monte Carlo del pronóstico — no compitieron en el backtest ni reemplazan el caso central."
      />
      <div className="space-y-6">
        {Object.values(escenarios).map((e) => (
          <div key={e.id}>
            <p className="font-semibold text-ink">{e.nombre}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{e.descripcion}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="tabular w-full min-w-[480px] text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[12px] text-muted">
                    <th className="py-2 font-medium">Familia</th>
                    <th className="py-2 text-right font-medium text-ink">Central</th>
                    <th className="py-2 text-right font-medium">Con la hipótesis</th>
                  </tr>
                </thead>
                <tbody>
                  {familias.map((f) => {
                    const base = Math.round(central[f.id]?.p50 ?? 0)
                    const v = Math.round(e.familias[f.id]?.p50 ?? 0)
                    const d = v - base
                    return (
                      <tr key={f.id} className="border-b border-hairline last:border-0">
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <Dot familia={f.id} size={8} />
                            {f.nombre_corto}
                          </span>
                        </td>
                        <td className="py-2 text-right font-semibold">{base}</td>
                        <td className="py-2 text-right">
                          {v}
                          <span className={`ml-1.5 inline-block w-7 text-left text-[11px] ${d > 0 ? 'text-good' : d < 0 ? 'text-critical' : 'text-muted'}`}>
                            {d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '·'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {e.listas_nuevas.map(
                    (l) =>
                      l.curules && (
                        <tr key={l.id} className="border-b border-hairline last:border-0">
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <Dot familia="otros" size={8} />
                              {l.nombre}
                            </span>
                          </td>
                          <td className="py-2 text-right text-muted">—</td>
                          <td className="py-2 text-right font-semibold">{Math.round(l.curules.p50)}</td>
                        </tr>
                      ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <Callout title="Qué es esto y qué no es">
        Esta hipótesis se tradujo a números concretos (a qué familias se mueve el voto, cuánto pesaría un movimiento nuevo) y se corrió por el mismo motor de Monte
        Carlo y cifra repartidora que el pronóstico de arriba — el reparto de curules no lo estimó la IA, lo calculó el mismo modelo. Pero los números de entrada sí
        son un supuesto externo, no una medición: no compitieron en el backtest de 2023 y no reemplazan el pronóstico central, que sigue siendo{' '}
        {p.nombre_regla.toLowerCase()}.
      </Callout>
    </>
  )
}

function Backtest({ pro, famPorId, familias }: { pro: TP; famPorId: Record<string, Familia>; familias: Familia[] }) {
  const bt = pro.backtest
  const vp = bt.volatilidad_previa
  const v = pro.pronostico.volatilidad
  const reglas = Object.entries(bt.metricas).sort((a, b) => a[1].mae_pp - b[1].mae_pp)
  const max = Math.max(...bt.familias.map((f) => Math.max(f.cuota.p90, f.real_cuota))) * 1.1
  const x = (s: number) => `${(s / max) * 100}%`
  const orden = Object.fromEntries(familias.map((f) => [f.id, f.orden]))
  return (
    <>
      <CardTitle
        title="¿Funciona? Backtest sobre 2023"
        subtitle="Se pronosticó 2023 usando solo información anterior (Concejo 2011–2019 y Cámara 2018–2022) y se comparó con el resultado real."
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <table className="tabular w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12px] text-muted">
                <th className="py-2 font-medium">Regla</th>
                <th className="py-2 text-right font-medium">Error medio</th>
                <th className="py-2 text-right font-medium">Error en curules</th>
              </tr>
            </thead>
            <tbody>
              {reglas.map(([k, m]) => (
                <tr key={k} className="border-b border-hairline last:border-0">
                  <td className="py-2.5">
                    {m.nombre}
                    {k === bt.elegido && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-[11px] text-plane">elegida</span>}
                  </td>
                  <td className="py-2.5 text-right">{dec(m.mae_pp, 2)} pp</td>
                  <td className="py-2.5 text-right">{m.error_curules_familias}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">Error medio: puntos porcentuales por familia. Error en curules: suma de diferencias absolutas por familia.</p>
          <Callout title="Lección de 2023">
            Con la volatilidad observada hasta 2019 (t de Student, ν = {dec(vp.nu, 0)}, escala {dec(vp.escala_t, 2)}) solo {pct(bt.cobertura_cuotas_80, 0)} de las cuotas
            reales cayó en el intervalo del 80 %: 2023 fue más turbulento que 2011–2019 (el salto del Nuevo Liberalismo, el crecimiento de las listas pequeñas). El
            pronóstico 2027 incorpora esa transición y la incertidumbre resultante tiene colas más pesadas (ν = {dec(v.nu, 1)}, escala {dec(v.escala_t, 2)}).
          </Callout>
        </div>
        <div>
          <p className="mb-3 text-[13px] text-ink-2">Cuota pronosticada (barra: 80 %) frente a la real (anillo)</p>
          <ul className="space-y-1">
            {[...bt.familias]
              .sort((a, b) => orden[a.familia] - orden[b.familia])
              .map((f) => (
                <li key={f.familia} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2 text-ink-2">
                    <Dot familia={f.familia} size={8} />
                    <span className="truncate">{famPorId[f.familia]?.nombre_corto}</span>
                  </span>
                  <span className="relative h-5">
                    <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--hairline)]" />
                    <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ left: x(f.cuota.p10), width: x(f.cuota.p90 - f.cuota.p10), background: famColor(f.familia), opacity: 0.45 }} />
                    <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface" style={{ left: x(f.real_cuota) }} />
                  </span>
                  <span className={`flex items-center justify-end gap-1 text-[12px] ${f.cuota_dentro_80 ? 'text-good' : 'text-critical'}`}>
                    {f.cuota_dentro_80 ? <Check size={13} /> : <X size={13} />}
                    {f.cuota_dentro_80 ? 'dentro' : 'fuera'}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </>
  )
}
