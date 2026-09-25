import { useState } from 'react'
import { destinosDeFila, ETIQUETA_PAR, filaSinDatos, haciaTexto, segmentosDeBarra } from '../lib/transferencia'
import { pct } from '../lib/format'
import type { Familia, TransferenciaOut } from '../lib/types'
import { Dot, Segmented, famColor } from './ui'

interface Par {
  key: string
  origen: string
  destino: string
  rol: (elegido: string) => string
}

/** Las cinco matrices estimadas (ver pipeline/transferencia.py:PARES) y para qué sirve cada una. */
const PARES: Par[] = [
  {
    key: 'camara_2022_2026',
    origen: 'la Cámara de 2022',
    destino: 'la Cámara de 2026',
    rol: (e) =>
      e === 'transferencia_matriz'
        ? 'Es la que usa el pronóstico 2027: el patrón de cambio observado entre 2022 y 2026 se aplica a los resultados del Concejo 2023.'
        : 'Alimenta el escenario alternativo «matriz de Cámara» del pronóstico 2027; el pronóstico base usa otro método.',
  },
  {
    key: 'camara_2018_2022',
    origen: 'la Cámara de 2018',
    destino: 'la Cámara de 2022',
    rol: () => 'Es la que se usó en el examen de 2023: con solo información anterior a esa elección, se le pidió «predecir» el Concejo 2023.',
  },
  {
    key: 'presidente_2022_concejo_2023',
    origen: 'la presidencial de 2022',
    destino: 'el Concejo de 2023',
    rol: (e) =>
      e === 'transferencia_matriz_presidencial'
        ? 'Es la que usa el pronóstico 2027: este puente se aplica a los resultados de la presidencial de 2026, la «tendencia actual».'
        : 'Alimenta el escenario alternativo «traducir la última presidencial al Concejo» del pronóstico 2027: este puente se aplica a los resultados de la presidencial de 2026. No es el método ganador.',
  },
  {
    key: 'presidente_2018_concejo_2019',
    origen: 'la presidencial de 2018',
    destino: 'el Concejo de 2019',
    rol: () =>
      'Es la que se usó en el examen de 2023: este puente se aplicó a los resultados de la presidencial de 2022 (la última anterior a 2023) para «predecir» el Concejo 2023.',
  },
  {
    key: 'concejo_2019_2023',
    origen: 'el Concejo de 2019',
    destino: 'el Concejo de 2023',
    rol: () =>
      'Solo referencia: muestra cómo se movió el voto entre los dos últimos Concejos. No se usa para pronosticar ni para el examen: ya contiene el resultado de 2023, y usarla sería copiar del cuaderno de respuestas.',
  },
]

const nombreCat = (cat: string, famPorId: Record<string, Familia>) => (cat === 'blanco' ? 'Voto en blanco' : (famPorId[cat]?.nombre_corto ?? cat))

const entero = (v: number) => Math.round(v * 100)

/** Explorador de las matrices de transferencia, pensado para leerse sin formación estadística. */
export default function FlujoVotos({ trans, elegido, famPorId }: { trans: TransferenciaOut; elegido: string; famPorId: Record<string, Familia> }) {
  const disponibles = PARES.filter((p) => trans[p.key])
  const [key, setKey] = useState(disponibles[0]?.key ?? 'camara_2022_2026')
  const par = disponibles.find((p) => p.key === key) ?? disponibles[0]
  if (!par) return null
  const m = trans[par.key]
  const sinCandidato = m.categorias.filter((c, i) => c !== 'blanco' && !filaSinDatos(m, i) && m.media[i][i] < 0.01)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Comparar entre</span>
        <Segmented
          label="Par de elecciones"
          size="sm"
          value={par.key}
          onChange={setKey}
          options={disponibles.map((p) => ({ value: p.key, label: ETIQUETA_PAR[p.key] ?? p.key }))}
        />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{par.rol(elegido)}</p>

      <p className="mt-5 text-[13px] leading-relaxed text-ink-2">
        <strong className="text-ink">Cómo leer cada fila:</strong> «de cada 100 votos que tenía esta familia en <em>{par.origen}</em>, así se repartieron en <em>{par.destino}</em>». La barra
        completa suma 100 y cada color es un destino.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5" aria-label="Colores de los destinos">
        {m.categorias.map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <Dot familia={c} size={9} />
            {nombreCat(c, famPorId)}
          </span>
        ))}
      </div>

      <ul className="mt-3">
        {m.categorias.map((cat, i) => {
          const nombre = nombreCat(cat, famPorId)
          if (filaSinDatos(m, i)) {
            return (
              <li key={cat} className="grid gap-x-4 gap-y-1 border-b border-hairline py-2.5 last:border-0 sm:grid-cols-[10.5rem_1fr]">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <Dot familia={cat} size={9} />
                  {nombre}
                </span>
                <span className="rounded-md border border-dashed border-hairline px-2.5 py-1.5 text-[12px] text-muted">Sin datos suficientes (ver nota al pie)</span>
              </li>
            )
          }
          const { queda, rangoQueda, otros } = destinosDeFila(m, i)
          const grandes = otros.filter((o) => o.p >= 0.05).slice(0, 3)
          const texto = [`Se queda ${entero(queda)} % (entre ${entero(rangoQueda[0])} y ${entero(rangoQueda[1])} %)`, ...grandes.map((o) => `${haciaTexto(o.categoria, nombreCat(o.categoria, famPorId))} ${entero(o.p)} %`)].join(' · ')
          return (
            <li key={cat} className="grid gap-x-4 gap-y-1 border-b border-hairline py-2.5 last:border-0 sm:grid-cols-[10.5rem_1fr]">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <Dot familia={cat} size={9} />
                {nombre}
              </span>
              <div>
                <div role="img" aria-label={`${nombre}: ${texto}`} className="flex h-3.5 gap-[2px]">
                  {segmentosDeBarra(m, i)
                    .filter((s) => s.p >= 0.005)
                    .map((s) => (
                      <span
                        key={s.categoria}
                        className="h-full min-w-[2px] rounded-[3px]"
                        style={{ flex: `${s.p} 1 0`, background: famColor(s.categoria) }}
                        title={`${s.categoria === cat ? 'Se queda en' : 'Pasa a'} ${nombreCat(s.categoria, famPorId)}: ${pct(s.p, 0)}`}
                      />
                    ))}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-ink-2">{texto}</p>
              </div>
            </li>
          )
        })}
      </ul>

      {sinCandidato.length > 0 && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">Filas con «se queda 0 %»</strong> ({sinCandidato.map((c) => nombreCat(c, famPorId)).join(', ')}): esa familia prácticamente no tuvo votación propia
          en <em>{par.destino}</em>, así que no había dónde «quedarse». El reparto de su fila solo indica hacia qué otras opciones se inclinaron los puestos donde era fuerte; no es un hallazgo sobre
          sus votantes.
        </p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        <strong className="font-semibold text-ink-2">Rango entre paréntesis:</strong> cuánto podría variar la cifra según los datos. Un rango angosto (por ejemplo entre 23 y 28&nbsp;%) indica
        que los puestos de votación la determinan bien; uno ancho, que es incierta. <strong className="font-semibold text-ink-2">Sin datos suficientes:</strong> la familia tuvo muy poca o
        ninguna votación propia en la elección de origen (por ejemplo, un partido que no llevó candidato a la Presidencia), así que no hay puestos donde observar hacia dónde se movió su voto;
        se deja en blanco en vez de mostrar un reparto parejo que sería solo el valor de partida del método.
      </p>
    </div>
  )
}
