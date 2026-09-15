import { ArrowUpRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hemicycle, type GrupoCurules } from '../components/Hemicycle'
import { RangoCurules } from '../components/RangoCurules'
import { Card, CardTitle, Legend, SectionHeader, Segmented, StatTile } from '../components/ui'
import { dec, pct, pp } from '../lib/format'
import type { Pronostico, Resultados } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Vista = '2019' | '2023' | '2027'

/** Redondeo por mayor resto: convierte curules esperadas en una composición entera que suma `total`. */
export function mayorResto(items: { id: string; v: number }[], total: number): Record<string, number> {
  const base = items.map((x) => ({ id: x.id, n: Math.floor(x.v), r: x.v - Math.floor(x.v) }))
  let faltan = total - base.reduce((s, b) => s + b.n, 0)
  for (const b of [...base].sort((a, c) => c.r - a.r)) {
    if (faltan <= 0) break
    b.n += 1
    faltan -= 1
  }
  return Object.fromEntries(base.map((b) => [b.id, b.n]))
}

function diasHasta(fecha: string) {
  const ms = new Date(`${fecha}T08:00:00-05:00`).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

export default function Resumen() {
  const { familias, famPorId } = useMeta()
  const res = useJson<Resultados>('resultados.json')
  const pro = useJson<Pronostico>('pronostico.json')
  const [vista, setVista] = useState<Vista>('2027')
  const [activo, setActivo] = useState<string | null>(null)

  const grupos = useMemo<GrupoCurules[]>(() => {
    if (vista === '2027') {
      const rep = mayorResto(pro.pronostico.familias.map((f) => ({ id: f.id, v: f.curules.media })), 44)
      return [
        ...familias.map((f) => ({ id: f.id, label: f.nombre_corto, familia: f.id, curules: rep[f.id] ?? 0 })),
        { id: 'oposicion', label: 'Curul de oposición (segundo en la Alcaldía, por definir)', familia: 'otros', curules: 1, oposicion: true },
      ]
    }
    const L = res[vista].listas
    const out: GrupoCurules[] = []
    for (const f of familias) {
      out.push({ id: f.id, label: f.nombre_corto, familia: f.id, curules: L.filter((l) => l.familia === f.id).reduce((s, l) => s + l.curules, 0) })
      for (const op of L.filter((l) => l.familia === f.id && l.oposicion)) {
        out.push({ id: f.id, label: `${op.nombre} · curul de oposición`, familia: f.id, curules: 1, oposicion: true })
      }
    }
    return out
  }, [vista, familias, res, pro])

  const c19 = res['2019'].ciudad
  const c23 = res['2023'].ciudad
  const fams = [...pro.pronostico.familias].sort((a, b) => b.curules.media - a.curules.media)
  const lider = [...pro.pronostico.familias].sort((a, b) => b.p_mayor_bancada - a.p_mayor_bancada)[0]
  const bt = pro.backtest
  const mejor = bt.metricas[bt.elegido]
  const oviedo = pro.pronostico.listas.find((l) => l.id === 'con_toda_por_bogota')
  const cambios = familias
    .map((f) => ({ f, d: (c23.familias_pct_validos[f.id] ?? 0) - (c19.familias_pct_validos[f.id] ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  const dias = diasHasta(pro.eleccion)

  return (
    <div>
      <SectionHeader
        eyebrow="Elecciones al Concejo de Bogotá · 31 de octubre de 2027"
        title={
          <>
            ¿Cómo quedará el Concejo <span className="italic text-ink-2">en 2027?</span>
          </>
        }
        lede={
          <>
            Un análisis de las elecciones de 2019 y 2023 construido desde los resultados mesa a mesa de la Registraduría,
            contrastado con 2011, 2015 y las legislativas y presidenciales de 2018 a 2026. El pronóstico resume{' '}
            {pro.n_simulaciones.toLocaleString('es-CO')} simulaciones de la elección, calibradas con un backtest sobre 2023.
          </>
        }
      >
        <div className="flex items-end gap-6 lg:flex-col lg:items-end lg:gap-1">
          <span className="text-[3.25rem] font-semibold leading-none tracking-tight">{dias}</span>
          <span className="pb-1 text-sm text-muted lg:pb-0">días para la elección</span>
        </div>
      </SectionHeader>

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardTitle
            title={vista === '2027' ? 'Composición más probable en 2027' : `Concejo elegido en ${vista}`}
            subtitle={
              vista === '2027'
                ? '44 curules por cifra repartidora según el número esperado de curules en las simulaciones, más la curul de oposición.'
                : '44 curules por cifra repartidora y 1 del Estatuto de la Oposición (anillo).'
            }
            right={
              <Segmented<Vista>
                label="Año"
                value={vista}
                onChange={setVista}
                options={[
                  { value: '2019', label: '2019' },
                  { value: '2023', label: '2023' },
                  { value: '2027', label: '2027 · pronóstico' },
                ]}
              />
            }
          />
          <Hemicycle grupos={grupos} resaltado={activo} onResaltar={setActivo} etiquetaCentro="45" subCentro="curules · mayoría 23" className="mx-auto w-full max-w-[560px]" />
          <div className="mt-5 border-t border-hairline pt-4">
            <Legend familias={familias} activo={activo} onActivar={setActivo} />
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <CardTitle
            title="Curules por familia en 2027"
            subtitle="Punto: mediana. Barra: 80 % de los escenarios; línea fina: 95 %. Anillo: curules obtenidas en 2023."
          />
          <RangoCurules
            filas={fams.map((f) => ({
              id: f.id,
              label: famPorId[f.id]?.nombre_corto ?? f.id,
              familia: f.id,
              curules: f.curules,
              referencia: f.curules_2023,
              referenciaLabel: 'Curules 2023',
            }))}
          />
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            {famPorId[lider.id]?.nombre} es la bancada más grande en el {pct(lider.p_mayor_bancada, 0)} de los escenarios.{' '}
            <Link to="/pronostico" className="link-underline text-ink-2">
              Ver pronóstico completo
            </Link>
          </p>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Participación 2023" value={pct(c23.participacion)} detail={`${pp(c23.participacion - c19.participacion)} frente a 2019`} tone={c23.participacion < c19.participacion ? 'bad' : 'good'} />
        <StatTile label="Voto en blanco 2023" value={pct(c23.pct_blanco)} detail={`${pp(c23.pct_blanco - c19.pct_blanco)} frente a 2019`} />
        <StatTile label="Número efectivo de listas" value={dec(c23.nep_votos, 1)} detail={`${dec(c19.nep_votos, 1)} en 2019`} />
        <StatTile label="Volatilidad 2019→2023" value={pct(res.pedersen_familias, 0)} detail="de los votos cambió de familia" />
      </div>

      <h2 className="display mt-16 text-3xl md:text-4xl">Lo que muestran los datos</h2>
      <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Hallazgo
          n="01"
          titulo="Un Concejo cada vez más fragmentado"
          texto={`En 2023 compitieron ${c23.listas_inscritas} listas y ${c23.listas_con_curul} obtuvieron curul. El número efectivo de listas pasó de ${dec(c19.nep_votos, 1)} a ${dec(c23.nep_votos, 1)}: ninguna fuerza supera el 16 % de los votos válidos.`}
        />
        <Hallazgo
          n="02"
          titulo={`El mayor cambio: ${cambios[0].f.nombre_corto}`}
          texto={`${cambios[0].f.nombre} ${cambios[0].d > 0 ? 'ganó' : 'perdió'} ${pp(Math.abs(cambios[0].d))} entre 2019 y 2023; le sigue ${cambios[1].f.nombre_corto} (${pp(cambios[1].d)}). Uno de cada ${Math.round(1 / res.pedersen_familias)} votos cambió de familia política.`}
        />
        <Hallazgo
          n="03"
          titulo="La Cámara no anticipa el Concejo"
          texto={`Proyectar 2023 con el cambio de la Cámara 2018→2022 falló más que repetir el Concejo anterior. La regla con menor error fuera de muestra fue «${mejor.nombre.toLowerCase()}» (error medio de ${dec(mejor.mae_pp, 1)} puntos por familia).`}
        />
        <Hallazgo
          n="04"
          titulo="Una fuerza nueva en el tablero"
          texto={
            oviedo
              ? `La Lista de Oviedo, sin historial en el Concejo, obtiene ${Math.round(oviedo.curules.p50)} curul${Math.round(oviedo.curules.p50) === 1 ? '' : 'es'} en la mediana (entre ${Math.round(oviedo.curules.p10)} y ${Math.round(oviedo.curules.p90)} en el 80 % de los escenarios) al convertir su votación a Cámara 2026.`
              : 'Los movimientos sin historial se proyectan desde su votación a Cámara 2026.'
          }
        />
      </div>

      <h2 className="display mt-16 text-3xl md:text-4xl">Explorar</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { to: '/resultados', t: 'Resultados y cifra repartidora', d: 'Votos, curules y cómo se asignó cada una de las 44.' },
          { to: '/mapa', t: 'Mapa de Bogotá', d: 'UPZ, localidades y puestos: fuerza, participación y bastiones.' },
          { to: '/territorio', t: 'Territorio y demografía', d: 'Las 20 localidades y la relación entre edad y voto.' },
          { to: '/candidatos', t: 'Candidatos', d: 'Quién sumó votos, dónde y con qué concentración.' },
          { to: '/pronostico', t: 'Pronóstico 2027', d: 'Distribuciones, coaliciones, escenarios y backtest.' },
          { to: '/simulador', t: 'Simulador de curules', d: 'Mueve los votos y mira cómo cambia el Concejo.' },
        ].map((x) => (
          <Link key={x.to} to={x.to} className="card group flex items-start justify-between gap-4 p-5 transition-transform hover:-translate-y-0.5">
            <span>
              <span className="block font-semibold tracking-tight">{x.t}</span>
              <span className="mt-1 block text-sm text-muted">{x.d}</span>
            </span>
            <ArrowUpRight className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-ink" size={18} />
          </Link>
        ))}
      </div>
    </div>
  )
}

function Hallazgo({ n, titulo, texto }: { n: string; titulo: string; texto: string }) {
  return (
    <article className="flex flex-col gap-3 border-t border-ink pt-4">
      <span className="tabular text-xs font-semibold text-muted">{n}</span>
      <h3 className="text-[1.05rem] font-semibold leading-snug tracking-tight">{titulo}</h3>
      <p className="text-[14px] leading-relaxed text-ink-2">{texto}</p>
    </article>
  )
}
