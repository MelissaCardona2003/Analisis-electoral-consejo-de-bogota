import { Check, Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Card, CardTitle, Dot, SectionHeader, Segmented, StatTile } from '../components/ui'
import { dec, num, pct } from '../lib/format'
import type { Candidato } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Anio = '2019' | '2023'
const quitarTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

export default function Candidatos() {
  const { meta, famPorId } = useMeta()
  const todos = useJson<Candidato[]>('candidatos.json')
  const [anio, setAnio] = useState<Anio>('2023')
  const [q, setQ] = useState('')
  const [lista, setLista] = useState('todas')
  const [soloElegidos, setSoloElegidos] = useState(false)
  const [limite, setLimite] = useState(40)
  const [sel, setSel] = useState<Candidato | null>(null)
  const qDiferida = useDeferredValue(q)

  const delAnio = useMemo(() => todos.filter((c) => c.anio === Number(anio)), [todos, anio])
  const listas = useMemo(() => [...new Map(delAnio.map((c) => [c.lista_id, c.lista_nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [delAnio])
  const filtrados = useMemo(() => {
    const k = quitarTildes(qDiferida.trim())
    return delAnio.filter((c) => (lista === 'todas' || c.lista_id === lista) && (!soloElegidos || c.elegido) && (!k || quitarTildes(c.nombre).includes(k)))
  }, [delAnio, qDiferida, lista, soloElegidos])

  const elegidos = delAnio.filter((c) => c.elegido)
  const minElegido = elegidos.reduce((m, c) => (c.votos < m.votos ? c : m), elegidos[0])
  const maxNoElegido = delAnio.filter((c) => !c.elegido).reduce((m, c) => (c.votos > m.votos ? c : m), delAnio[0])
  const repitentes = delAnio.filter((c) => c.compitio_ambos).length
  const activo = sel && sel.anio === Number(anio) ? sel : null
  const otro = activo ? todos.find((c) => c.clave === activo.clave && c.anio !== activo.anio) : undefined

  return (
    <div>
      <SectionHeader
        eyebrow="Candidatos"
        title="Quién sumó los votos, y dónde"
        lede="Votación de cada candidato en listas con voto preferente, su peso dentro de la lista y qué tan concentrado está su voto en el territorio. Las listas cerradas (Colombia Humana en 2019, Pacto Histórico en 2023) no tienen voto por candidato."
      >
        <Segmented<Anio>
          label="Año"
          value={anio}
          onChange={(v) => {
            setAnio(v)
            setLista('todas')
            setLimite(40)
          }}
          options={[
            { value: '2019', label: '2019' },
            { value: '2023', label: '2023' },
          ]}
        />
      </SectionHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Candidatos con voto preferente" value={num(delAnio.length)} detail={`${num(elegidos.length)} elegidos por lista preferente`} />
        <StatTile label="Mayor votación" value={num(delAnio[0]?.votos ?? 0)} detail={delAnio[0]?.nombre} />
        <StatTile label="Elegido con menos votos" value={num(minElegido?.votos ?? 0)} detail={minElegido ? `${minElegido.nombre} · ${minElegido.lista_nombre}` : ''} />
        <StatTile label="No elegido con más votos" value={num(maxNoElegido?.votos ?? 0)} detail={maxNoElegido ? `${maxNoElegido.nombre} · ${maxNoElegido.lista_nombre}` : ''} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-full border border-hairline bg-surface px-3">
              <Search size={14} className="text-muted" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setLimite(40)
                }}
                placeholder="Buscar candidato (sin importar tildes)"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
                aria-label="Buscar candidato"
              />
            </label>
            <select value={lista} onChange={(e) => setLista(e.target.value)} aria-label="Lista" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
              <option value="todas">Todas las listas</option>
              {listas.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={soloElegidos} onChange={(e) => setSoloElegidos(e.target.checked)} className="size-4 accent-[var(--ink)]" />
              Solo elegidos
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] text-muted">
                  <th className="py-2 font-medium">Candidato</th>
                  <th className="py-2 font-medium">Lista</th>
                  <th className="py-2 text-right font-medium">Votos</th>
                  <th className="py-2 text-right font-medium">% de su lista</th>
                  <th className="py-2 text-right font-medium">Puesto</th>
                  <th className="py-2 pl-3 font-medium">Concentración</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, limite).map((c) => (
                  <tr
                    key={`${c.anio}-${c.lista_id}-${c.clave}`}
                    onClick={() => setSel(c)}
                    className={`cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-2 ${activo?.clave === c.clave && activo.lista_id === c.lista_id ? 'bg-surface-2' : ''}`}
                  >
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        {c.nombre}
                        {c.elegido && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-ink px-1.5 py-px text-[10px] text-plane">
                            <Check size={10} /> electo
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-1.5 text-ink-2">
                        <Dot familia={c.familia_id} size={8} />
                        <span className="max-w-[12rem] truncate">{c.lista_nombre}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium">{num(c.votos)}</td>
                    <td className="py-2 text-right">{pct(c.pct_de_lista)}</td>
                    <td className="py-2 text-right text-ink-2">{c.rank_lista}</td>
                    <td className="py-2 pl-3">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 rounded-full bg-surface-2">
                          <span className="block h-full rounded-full bg-ink" style={{ width: `${c.gini_puestos * 100}%` }} />
                        </span>
                        <span className="text-[12px] text-muted">{dec(c.gini_puestos, 2)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
            <span>
              {num(Math.min(limite, filtrados.length))} de {num(filtrados.length)} candidatos
            </span>
            {limite < filtrados.length && (
              <button className="font-medium text-ink link-underline" onClick={() => setLimite(limite + 60)}>
                Ver más
              </button>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-4 lg:self-start lg:sticky lg:top-24">
          {activo ? (
            <>
              <CardTitle title={activo.nombre} subtitle={`${activo.lista_nombre} · ${famPorId[activo.familia_id]?.nombre_corto}`} />
              <div className="grid grid-cols-3 gap-3 text-[13px]">
                <Dato label="Votos" value={num(activo.votos)} />
                <Dato label="Puesto en lista" value={`${activo.rank_lista}.º`} />
                <Dato label="Resultado" value={activo.elegido ? 'Electo' : 'No electo'} />
              </div>
              <p className="mt-5 eyebrow">Votos por localidad</p>
              <ul className="mt-2 space-y-1">
                {activo.vector_localidades
                  .map((v, i) => ({ v, i: i + 1 }))
                  .sort((a, b) => b.v - a.v)
                  .slice(0, 10)
                  .map(({ v, i }) => (
                    <li key={i} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-[12px]">
                      <span className="truncate text-ink-2">{meta.localidades[String(i)]}</span>
                      <span className="h-1.5 rounded-r-[3px] bg-surface-2">
                        <span className="block h-full rounded-r-[3px]" style={{ width: `${(v / activo.vector_localidades.reduce((m, x) => Math.max(m, x), 0.0001)) * 100}%`, background: `var(--fam-${activo.familia_id})` }} />
                      </span>
                      <span className="tabular text-right">{pct(v, 0)}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-4 text-[12px] leading-relaxed text-muted">
                Concentración (Gini entre puestos): {dec(activo.gini_puestos, 2)}. {activo.gini_puestos > 0.7 ? 'Voto muy concentrado en pocos puestos: perfil de líder barrial.' : activo.gini_puestos < 0.5 ? 'Voto repartido por toda la ciudad: perfil de opinión.' : 'Voto con núcleos territoriales definidos.'}
              </p>
              {otro && (
                <div className="mt-5 rounded-2xl bg-surface-2 p-4 text-[13px]">
                  <p className="font-semibold">También compitió en {otro.anio}</p>
                  <p className="mt-1 text-ink-2">
                    {num(otro.votos)} votos con {otro.lista_nombre} ({otro.elegido ? 'electo' : 'no electo'}). Cambio: {activo.votos >= otro.votos ? '+' : '−'}
                    {num(Math.abs(activo.votos - otro.votos))}.
                  </p>
                  {activo.similitud_territorial != null && (
                    <p className="mt-1 text-ink-2">
                      Similitud de su mapa de votos entre elecciones: <strong className="text-ink">{dec(activo.similitud_territorial, 2)}</strong> (1 = mismo patrón).
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <CardTitle title="Selecciona un candidato" subtitle="Toca una fila para ver dónde sacó sus votos y cómo le fue si compitió en ambas elecciones." />
              <p className="text-[13px] leading-relaxed text-ink-2">
                En {anio}, {num(repitentes)} candidatos de listas preferentes también habían competido en {anio === '2023' ? '2019' : '2023'}. La comparación usa el nombre normalizado sin tildes
                ni eñes (por ejemplo, «Niño» y «Nino» son la misma persona en los archivos de la Registraduría).
              </p>
            </>
          )}
        </Card>
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
