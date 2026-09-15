import * as Slider from '@radix-ui/react-slider'
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Hemicycle, type GrupoCurules } from '../components/Hemicycle'
import { Card, CardTitle, Dot, SectionHeader, Segmented } from '../components/ui'
import { cifraRepartidora } from '../lib/dhondt'
import { dec, num, pct } from '../lib/format'
import type { Simulador as TS } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Base = 'pronostico' | 'r2023'
const BLANCO = '__blanco'

function Control({ id, label, familia, valor, onChange, max = 30, delta }: { id: string; label: string; familia?: string; valor: number; onChange: (v: number) => void; max?: number; delta?: number }) {
  return (
    <div className="grid grid-cols-[1fr_4.25rem] items-center gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,10rem)_1fr_4.25rem]">
      <label htmlFor={id} className="col-span-2 flex min-w-0 items-center gap-2 text-[13px] text-ink-2 sm:col-span-1">
        {familia ? <Dot familia={familia} size={8} /> : <span className="size-2 rounded-full bg-[var(--fam-blanco)]" />}
        <span className="truncate">{label}</span>
      </label>
      <Slider.Root
        id={id}
        className="relative flex h-6 touch-none select-none items-center"
        min={0}
        max={max}
        step={0.1}
        value={[valor * 100]}
        onValueChange={([v]) => onChange(v / 100)}
        aria-label={`${label}: porcentaje de votos válidos`}
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-[var(--hairline)]">
          <Slider.Range className="absolute h-full rounded-full" style={{ background: familia ? `var(--fam-${familia})` : 'var(--axis)' }} />
        </Slider.Track>
        <Slider.Thumb className="block size-4 rounded-full border-2 border-ink bg-surface shadow-sm" />
      </Slider.Root>
      <span className="tabular text-right text-[13px]">
        {dec(valor * 100, 1)} %
        {delta !== undefined && Math.abs(delta) >= 0.0005 && (
          <span className={`block text-[11px] ${delta > 0 ? 'text-good' : 'text-critical'}`}>
            {delta > 0 ? '+' : '−'}
            {dec(Math.abs(delta) * 100, 1)}
          </span>
        )}
      </span>
    </div>
  )
}

export default function Simulador() {
  const { familias } = useMeta()
  const sim = useJson<TS>('simulador.json')
  const [base, setBase] = useState<Base>('pronostico')

  const inicial = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of sim.listas) m[l.id] = base === 'pronostico' ? l.cuota : l.cuota_2023
    m[BLANCO] = base === 'pronostico' ? sim.blanco : sim.blanco_2023
    const tot = Object.values(m).reduce((s, v) => s + v, 0)
    for (const k of Object.keys(m)) m[k] /= tot
    return m
  }, [sim, base])

  const [cuotas, setCuotas] = useState<Record<string, number>>(inicial)
  const [participacion, setParticipacion] = useState(sim.participacion_2027)
  const [ultimaBase, setUltimaBase] = useState<Base>(base)
  if (ultimaBase !== base) {
    setUltimaBase(base)
    setCuotas(inicial)
  }

  /** Cambia una categoría y reescala las demás para que el total siga en 100 %. */
  const mover = (id: string, v: number) => {
    setCuotas((prev) => {
      const restoAntes = 1 - prev[id]
      const nuevo = Math.min(Math.max(v, 0), 0.95)
      const factor = restoAntes > 0 ? (1 - nuevo) / restoAntes : 0
      const out: Record<string, number> = {}
      for (const k of Object.keys(prev)) out[k] = k === id ? nuevo : prev[k] * factor
      return out
    })
  }

  const fracValidos = sim.validos_2027 / (sim.potencial_2027 * sim.participacion_2027)
  const validos = sim.potencial_2027 * participacion * fracValidos
  const reparto = useMemo(
    () => cifraRepartidora(sim.listas.map((l) => ({ id: l.id, votos: cuotas[l.id] * validos })), cuotas[BLANCO] * validos),
    [cuotas, validos, sim.listas],
  )
  const referencia = useMemo(
    () => cifraRepartidora(sim.listas.map((l) => ({ id: l.id, votos: inicial[l.id] * validos })), inicial[BLANCO] * validos),
    [inicial, validos, sim.listas],
  )

  const orden = Object.fromEntries(familias.map((f) => [f.id, f.orden]))
  const listasOrd = [...sim.listas].sort((a, b) => orden[a.familia] - orden[b.familia] || inicial[b.id] - inicial[a.id])
  const grupos: GrupoCurules[] = listasOrd
    .filter((l) => reparto.curules[l.id] > 0)
    .map((l) => ({ id: l.id, label: l.nombre, familia: l.familia, curules: reparto.curules[l.id] }))
  const nombre = (id: string | null) => sim.listas.find((l) => l.id === id)?.nombre ?? '—'

  return (
    <div>
      <SectionHeader
        eyebrow="Simulador de curules"
        title="Mueve los votos, reparte el Concejo"
        lede="Ajusta la cuota de cada lista y del voto en blanco: las demás se reescalan para sumar 100 %. El reparto aplica el mismo umbral y la misma cifra repartidora que la Registraduría."
      >
        <div className="flex items-center gap-2">
          <Segmented<Base>
            label="Punto de partida"
            value={base}
            onChange={setBase}
            options={[
              { value: 'pronostico', label: 'Pronóstico 2027' },
              { value: 'r2023', label: 'Resultado 2023' },
            ]}
          />
          <button
            type="button"
            onClick={() => {
              setCuotas(inicial)
              setParticipacion(sim.participacion_2027)
            }}
            className="grid size-9 place-items-center rounded-full border border-hairline text-ink-2 hover:text-ink"
            aria-label="Restablecer"
            title="Restablecer"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </SectionHeader>

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <CardTitle title="Votos por lista" subtitle="Porcentaje de votos válidos. Debajo del valor, la diferencia con el punto de partida." />
          {familias.map((f) => {
            const ls = listasOrd.filter((l) => l.familia === f.id)
            if (!ls.length) return null
            return (
              <div key={f.id} className="border-b border-hairline py-2 last:border-0">
                {ls.map((l) => (
                  <Control key={l.id} id={`s-${l.id}`} label={l.nombre} familia={l.familia} valor={cuotas[l.id]} onChange={(v) => mover(l.id, v)} delta={cuotas[l.id] - inicial[l.id]} />
                ))}
              </div>
            )
          })}
          <div className="pt-2">
            <Control id="s-blanco" label="Voto en blanco" valor={cuotas[BLANCO]} onChange={(v) => mover(BLANCO, v)} delta={cuotas[BLANCO] - inicial[BLANCO]} />
            <div className="grid grid-cols-[1fr_4.25rem] items-center gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,10rem)_1fr_4.25rem]">
              <label htmlFor="s-part" className="col-span-2 text-[13px] text-ink-2 sm:col-span-1">
                Participación
              </label>
              <Slider.Root id="s-part" className="relative flex h-6 touch-none select-none items-center" min={30} max={70} step={0.5} value={[participacion * 100]} onValueChange={([v]) => setParticipacion(v / 100)} aria-label="Participación">
                <Slider.Track className="relative h-1 grow rounded-full bg-[var(--hairline)]">
                  <Slider.Range className="absolute h-full rounded-full bg-ink" />
                </Slider.Track>
                <Slider.Thumb className="block size-4 rounded-full border-2 border-ink bg-surface shadow-sm" />
              </Slider.Root>
              <span className="tabular text-right text-[13px]">{dec(participacion * 100, 1)} %</span>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-6">
          <Card className="lg:sticky lg:top-24">
            <CardTitle title="Concejo resultante" subtitle="44 curules por cifra repartidora (la de oposición depende de la Alcaldía)." />
            <Hemicycle grupos={grupos} etiquetaCentro="44" subCentro="curules · mayoría 23 de 45" className="mx-auto w-full max-w-[440px]" />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4 text-[13px]">
              <Dato label="Votos válidos" value={num(validos)} />
              <Dato label="Umbral" value={num(reparto.umbral)} />
              <Dato label="Cifra repartidora" value={num(reparto.cifra)} />
            </div>
            <table className="tabular mt-4 w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] text-muted">
                  <th className="py-1.5 font-medium">Lista</th>
                  <th className="py-1.5 text-right font-medium">Curules</th>
                  <th className="py-1.5 text-right font-medium">Cambio</th>
                  <th className="py-1.5 text-right font-medium">Para una más</th>
                </tr>
              </thead>
              <tbody>
                {listasOrd.map((l) => {
                  const c = reparto.curules[l.id]
                  const d = c - referencia.curules[l.id]
                  const fuera = cuotas[l.id] * validos < reparto.umbral
                  return (
                    <tr key={l.id} className="border-b border-hairline last:border-0">
                      <td className="py-1.5">
                        <span className={`flex items-center gap-2 ${fuera ? 'text-muted' : ''}`}>
                          <Dot familia={l.familia} size={8} />
                          {l.nombre}
                          {fuera && <span className="text-[11px]">bajo el umbral</span>}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-semibold">{c}</td>
                      <td className={`py-1.5 text-right ${d > 0 ? 'text-good' : d < 0 ? 'text-critical' : 'text-muted'}`}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '·'}</td>
                      <td className="py-1.5 text-right text-ink-2">{num(reparto.votosParaOtraCurul[l.id])}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-muted">
              La curul 44 fue para {nombre(reparto.ultimaCurul)}; la siguiente en fila era {nombre(reparto.siguienteEnFila)}. Total asignado: {pct(Object.values(cuotas).reduce((s, v) => s + v, 0), 0)} de los votos.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="tabular font-semibold">{value}</p>
    </div>
  )
}
