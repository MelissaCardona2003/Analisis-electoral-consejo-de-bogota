import { Check } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import FlujoVotos from '../components/FlujoVotos'
import { Callout, Card, CardTitle, Dot, SectionHeader } from '../components/ui'
import { dec, num, pct } from '../lib/format'
import { METODOS, nombreMetodo } from '../lib/metodos'
import { destinosDeFila, ETIQUETA_PAR, filaSinDatos, haciaTexto, mayorFlujoFuera } from '../lib/transferencia'
import type { EscenariosIAOut, Pronostico, TransferenciaOut } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

interface Calidad {
  ingesta: Record<
    string,
    {
      archivo: string
      filas_archivo: number
      votos_no_numericos: number
      votos_negativos: number
      textos_corregidos: Record<string, number>
      localidad_inconsistente_con_zona: number
      codigo_candidato_compartido_por_personas_distintas: { partido_cod: string; candidato_cod: string; candidato_nombre: string }[]
      duplicados_exactos_eliminados: number
      filas_con_cero_votos: number
      filas_concejo: number
      puestos_concejo: number
      mesas_concejo: number
    }
  >
  censo: Record<string, { puestos: number; potencial_total: number; filas_sexo_no_cuadra: number; filas_edad_no_cuadra: number }>
  reparacion_espacios: { cambios: [string, string][]; ambiguos_para_revision: string[] }
  comunas_originales: Record<string, string[]>
  externas: Record<string, { archivo?: string; formato?: string; codificacion?: string; resumen?: Record<string, { puestos: number }> }>
  geocodificacion: Record<string, Record<string, number>>
  validacion_curules: Record<string, { coincide: boolean; cociente: number; umbral: number; cifra_repartidora: number }>
  crosswalk: { eleccion: string; partido_nombre: string; votos_lista: number; familia_id: string; peso: number; fuente: string }[]
}

const ETIQUETA_ELECCION: Record<string, string> = {
  concejo_2019: 'Concejo 2019', concejo_2023: 'Concejo 2023', camara_2018: 'Cámara 2018', camara_2022: 'Cámara 2022', camara_2026: 'Cámara 2026',
  senado_2022: 'Senado 2022', senado_2026: 'Senado 2026', presidente_2018: 'Presidencia 2018', presidente_2022: 'Presidencia 2022', presidente_2026: 'Presidencia 2026',
}

const GLOSARIO: [string, string][] = [
  ['Curul', 'Puesto en el Concejo de Bogotá. Se eligen 44.'],
  ['Votos válidos', 'Votos por listas más voto en blanco. No incluye votos nulos ni tarjetas no marcadas.'],
  ['Cuota', 'Porcentaje de los votos válidos que recibe una familia o una lista.'],
  ['Familia política', 'Agrupación de partidos con continuidad entre elecciones, creada para poder compararlas. No implica alianzas (sección 3).'],
  ['Siglas de las familias', 'CR: Cambio Radical. U: Partido de la U. MIRA: Movimiento MIRA. Cons.: Partido Conservador. CJL: Colombia Justa Libres. «Otras» reúne a los partidos pequeños.'],
  ['Cifra repartidora', 'Fórmula legal para repartir curules: se dividen los votos de cada lista entre 1, 2, 3… y las curules van a los mayores resultados.'],
  ['Umbral', 'Votación mínima para tener curul: 50 % del cociente electoral, cerca del 1,14 % de los votos válidos con 44 curules.'],
  ['Punto porcentual (pts)', 'Diferencia entre dos porcentajes: pasar de 10 % a 12 % son 2 puntos.'],
  ['Backtest (examen)', 'Probar un método con el pasado: predecir una elección ya ocurrida usando solo lo que se sabía antes, y comparar con el resultado real.'],
  ['Simulación (Monte Carlo)', 'Repetir el cálculo miles de veces, cada vez con un poco de azar realista, para ver todo el abanico de resultados posibles y con qué frecuencia aparece cada uno.'],
  ['Rango del 80 %', 'Intervalo donde cae el 80 % de las simulaciones (del percentil 10 al 90): lo más probable, dejando fuera los extremos.'],
  ['Matriz de transferencia', 'Tabla que dice, de cada 100 votos de una familia en una elección, cuántos se quedaron y cuántos pasaron a cada otra en la siguiente.'],
  ['Inferencia ecológica', 'Estimar cómo se comportaron los individuos a partir de totales de grupos (los puestos de votación). Da tendencias, no certezas.'],
]

export default function Metodologia() {
  const { meta, famPorId } = useMeta()
  const cal = useJson<Calidad>('calidad.json')
  const pro = useJson<Pronostico>('pronostico.json')
  const trans = useJson<TransferenciaOut>('transferencia.json')
  const escenariosIA = useJson<EscenariosIAOut>('escenarios_ia.json')
  const [eleccionXw, setEleccionXw] = useState('camara_2026')
  const xw = useMemo(() => cal.crosswalk.filter((r) => r.eleccion === eleccionXw).sort((a, b) => b.votos_lista - a.votos_lista), [cal, eleccionXw])
  const v = pro.pronostico.volatilidad
  const i19 = cal.ingesta['2019']
  const i23 = cal.ingesta['2023']

  const bt = pro.backtest
  const metodos = Object.entries(bt.metricas).sort((a, b) => a[1].mae_pp - b[1].mae_pp)
  const puesto = (clave: string) => metodos.findIndex(([k]) => k === clave) + 1
  const ganador = bt.metricas[bt.elegido]
  const simple = bt.metricas.persistencia
  const mejorCurules = Object.entries(bt.metricas).reduce((a, b) => (b[1].error_curules_familias < a[1].error_curules_familias ? b : a))
  const mMat = bt.metricas.transferencia_matriz
  const mKapPres = bt.metricas.transferencia_presidencial
  const mMatPres = bt.metricas.transferencia_matriz_presidencial
  const decimas = (x?: number) => (x === undefined ? null : Math.round(x * 10))
  const antes80 = decimas(bt.cobertura_cuotas_80_sin_calibrar)
  const despues80 = decimas(bt.cobertura_cuotas_80)
  const fuera80 = bt.familias.filter((f) => !f.cuota_dentro_80)
  const cabeza = [...pro.pronostico.familias].sort((a, b) => b.curules.p50 - a.curules.p50)[0]
  const nombreFam = (id: string) => (id === 'blanco' ? 'Voto en blanco' : (famPorId[id]?.nombre_corto ?? id))
  const mCam = trans?.camara_2022_2026
  const flujoPronostico = mCam ? mayorFlujoFuera(mCam) : null
  const nl = bt.familias.find((f) => f.familia === 'nuevo_liberalismo')
  const ejemplo = (() => {
    if (!mCam) return null
    const i = mCam.categorias.indexOf('alianza_verde')
    if (i < 0 || filaSinDatos(mCam, i)) return null
    const { queda, otros } = destinosDeFila(mCam, i)
    return { queda: Math.round(queda * 100), top: otros.slice(0, 3) }
  })()

  return (
    <div>
      <SectionHeader
        eyebrow="Metodología y calidad de datos"
        title="Cómo se hizo, paso a paso"
        lede="Todo el análisis es reproducible desde los archivos oficiales. Esta página documenta la limpieza de los datos, las validaciones que tuvieron que pasar y el modelo, incluidos sus límites."
      />

      <Card>
        <CardTitle title="En pocas palabras" subtitle="Si solo tiene un minuto, lea esto." />
        <ul className="grid gap-x-8 gap-y-4 text-[14px] leading-relaxed text-ink-2 md:grid-cols-2">
          <li>
            <strong className="text-ink">Los datos.</strong> Resultados oficiales de la Registraduría, puesto de votación por puesto de votación (cerca de {num(cal.censo['2023'].puestos)} en Bogotá), del
            Concejo 2019 y 2023, la Cámara, el Senado y la Presidencia. Se limpiaron y se comprobó que las cuentas cuadren con los resultados oficiales.
          </li>
          <li>
            <strong className="text-ink">La pregunta.</strong> ¿Cuántas de las 44 curules del Concejo podría obtener cada fuerza política en 2027? Nadie puede saberlo con certeza, por eso el
            resultado es un rango, no una cifra única.
          </li>
          <li>
            <strong className="text-ink">El método.</strong> Se agrupan los partidos en nueve «familias», se estima cómo se moverá el voto de cada una a partir de cómo se movió en elecciones
            anteriores y se simula el resultado {pro.n_simulaciones.toLocaleString('es-CO')} veces, con un margen de azar realista, para repartir las curules con la fórmula legal.
          </li>
          <li>
            <strong className="text-ink">La prueba.</strong> Antes de confiar en el modelo se le pidió «predecir» el Concejo 2023 con solo lo que se sabía antes. Se compararon seis métodos y se usa el que
            menos se equivocó; aun así falló en varias familias, y por eso los rangos son amplios y así se muestran.
          </li>
        </ul>
        <p className="mt-4 text-[13px] text-muted">
          Los términos técnicos se explican en el glosario, al final. Las secciones 4 a 6 describen el modelo; los detalles matemáticos están en bloques desplegables para quien quiera auditarlos.
        </p>
      </Card>

      <Card className="mt-5">
        <CardTitle title="Validaciones" subtitle="Controles automáticos que el análisis debe superar antes de publicarse." />
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            `El cálculo de curules (cifra repartidora) reproduce la composición oficial del Concejo en 2011, 2015, 2019 y 2023.`,
            `El simulador de esta página reparte las curules exactamente igual que el cálculo original en 2019 y 2023.`,
            `Censo electoral: hombres + mujeres = potencial y rangos de edad + extranjeros = potencial en los ${num(cal.censo['2019'].puestos + cal.censo['2023'].puestos)} puestos.`,
            `Todos los puestos con votos al Concejo tienen censo y viceversa (${cal.censo['2019'].puestos} en 2019, ${cal.censo['2023'].puestos} en 2023).`,
            `Votos del Concejo 2019 cuadran con el escrutinio oficial (p. ej. voto en blanco 529.514, nulos 112.118).`,
            `Los nombres de partidos y candidatos se normalizan (tildes, espacios invisibles, palabras partidas) y se prueba que no se pierdan ni se mezclen.`,
          ].map((t) => (
            <li key={t} className="flex gap-3 text-[14px] leading-relaxed text-ink-2">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-good text-plane">
                <Check size={12} strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle title="1 · Ingesta y limpieza" subtitle="Los archivos oficiales venían con formatos y errores distintos. Aquí se documenta qué se encontró y cómo se corrigió, para que cualquiera pueda verificarlo." />
          <table className="tabular w-full text-[13px]">
            <tbody>
              <Fila k="Filas mesa a mesa leídas (2019 / 2023)" v={`${num(i19.filas_archivo)} / ${num(i23.filas_archivo)}`} />
              <Fila k="Filas del Concejo" v={`${num(i19.filas_concejo)} / ${num(i23.filas_concejo)}`} />
              <Fila k="Mesas" v={`${num(i19.mesas_concejo)} / ${num(i23.mesas_concejo)}`} />
              <Fila k="Votos no numéricos o negativos" v={`${i19.votos_no_numericos + i19.votos_negativos + i23.votos_no_numericos + i23.votos_negativos}`} />
              <Fila k="Duplicados exactos eliminados" v={`${i19.duplicados_exactos_eliminados + i23.duplicados_exactos_eliminados}`} />
              <Fila k="Filas con 0 votos (se conservan)" v={`${num(i19.filas_con_cero_votos)} / ${num(i23.filas_con_cero_votos)}`} />
            </tbody>
          </table>
          <p className="mt-5 eyebrow">Problemas encontrados y cómo se resolvieron</p>
          <ul className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-ink-2">
            <li>
              <strong className="text-ink">Localidades con el código pegado</strong> en 2019 (<code className="rounded bg-surface-2 px-1">{cal.comunas_originales['2019']?.[0]}</code>) y comuna
              «NACIONAL» en 2023 para Corferias y cárceles: la localidad se toma del código de zona y se verifica contra el nombre (0 inconsistencias).
            </li>
            <li>
              <strong className="text-ink">Palabras partidas por espacios espurios</strong>, reparadas con un vocabulario construido desde los propios datos (solo si la unión es inequívoca):{' '}
              {cal.reparacion_espacios.cambios.map(([a, b]) => (
                <span key={a} className="block">
                  <code className="rounded bg-surface-2 px-1">{a.slice(-24)}</code> → <code className="rounded bg-surface-2 px-1">{b.slice(-24)}</code>
                </span>
              ))}
            </li>
            <li>
              <strong className="text-ink">Tildes y eñes inconsistentes</strong> entre años («NIÑO»/«NINO», «DEMOCRÁTICO»/«DEMOCRATICO»): las comparaciones usan una llave sin diacríticos; la
              visualización conserva la forma correcta.
            </li>
            <li>
              <strong className="text-ink">Mismo código para dos candidatos</strong> en 2019:{' '}
              {i19.codigo_candidato_compartido_por_personas_distintas.map((c) => c.candidato_nombre.toLowerCase()).join(' y ')} comparten el código {i19.codigo_candidato_compartido_por_personas_distintas[0]?.candidato_cod}{' '}
              en la lista de la FARC. No son duplicados: se conservan ambos.
            </li>
            <li>
              <strong className="text-ink">Códigos reutilizados:</strong> el partido 00017 era PRE en 2019 y Dignidad &amp; Compromiso en 2023; los números de puesto también cambian. Por eso las
              equivalencias van por elección y los puestos se emparejan por nombre, no solo por código.
            </li>
          </ul>
        </Card>

        <Card>
          <CardTitle title="2 · Fuentes externas" subtitle="Cada archivo de la Registraduría usaba un formato diferente; todos se normalizan a un mismo esquema por puesto." />
          <ul className="space-y-2 text-[13px]">
            {[
              ['Concejo 2019 y 2023', 'CSV UTF-8 mesa a mesa + censo por puesto (UTF-8 con BOM, encabezado doble, miles con punto)'],
              ['Cámara y Senado 2022', `CSV en ${cal.externas.congreso_2022?.codificacion?.toUpperCase() ?? 'UTF-16'} de 825 MB`],
              ['Cámara y Senado 2026', 'CSV de 9,7 GB solo con códigos, filtrado en streaming a Bogotá (28,6 M filas) + archivos básicos de ancho fijo en cp1252'],
              ['Presidencia 1.ª vuelta 2018', 'Libro XLSX nacional (hojas de escrutinio y DIVIPOL)'],
              ['Presidencia 1.ª vuelta 2022', `CSV nacional en ${cal.externas.presidente_2022?.codificacion ?? 'cp1252'} separado por «;»`],
              ['Presidencia 1.ª vuelta 2026', 'CSV de códigos + archivos básicos de ancho fijo'],
              ['Cámara 2018 (Bogotá)', 'Datos Abiertos Colombia (conjunto publicado por la Registraduría), agregado por puesto'],
              ['Concejo 2011 y 2015', 'Totales por partido publicados (solo nivel ciudad, para calibrar la volatilidad)'],
            ].map(([a, b]) => (
              <li key={a} className="grid gap-1 border-b border-hairline pb-2 last:border-0 sm:grid-cols-[11rem_1fr]">
                <span className="font-medium">{a}</span>
                <span className="text-ink-2">{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 eyebrow">Ubicar cada puesto en el mapa (geocodificación)</p>
          <table className="tabular mt-2 w-full text-[12px]">
            <thead>
              <tr className="border-b border-hairline text-muted">
                <th className="py-1.5 text-left font-medium">Elección</th>
                <th className="py-1.5 text-right font-medium">Alta</th>
                <th className="py-1.5 text-right font-medium">Media</th>
                <th className="py-1.5 text-right font-medium">Baja</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cal.geocodificacion)
                .filter(([e]) => !e.startsWith('senado'))
                .map(([e, g]) => {
                  const tot = Object.values(g).reduce((s, x) => s + x, 0)
                  return (
                    <tr key={e} className="border-b border-hairline last:border-0">
                      <td className="py-1.5">{ETIQUETA_ELECCION[e] ?? e}</td>
                      <td className="py-1.5 text-right">{pct((g.alta ?? 0) / tot, 0)}</td>
                      <td className="py-1.5 text-right">{pct((g.media ?? 0) / tot, 0)}</td>
                      <td className="py-1.5 text-right">{pct((g.baja ?? 0) / tot, 0)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">Confianza alta: el nombre del puesto coincide casi exactamente (≥ 86 sobre 100) con uno del catálogo de la misma localidad.</p>
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle
          title="3 · Familias políticas y coaliciones"
          subtitle="Para comparar elecciones, cada lista se asigna a una familia con continuidad. Las coaliciones entre familias se reparten según la votación propia de cada socio en el Concejo."
          right={
            <select value={eleccionXw} onChange={(e) => setEleccionXw(e.target.value)} aria-label="Elección" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
              {[...new Set(cal.crosswalk.map((r) => r.eleccion))].map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_ELECCION[e] ?? e}
                </option>
              ))}
            </select>
          }
        />
        <div className="max-h-[420px] overflow-auto">
          <table className="tabular w-full min-w-[560px] text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-left text-[12px] text-muted">
                <th className="py-2 font-medium">Lista o candidatura</th>
                <th className="py-2 text-right font-medium">Votos</th>
                <th className="py-2 pl-4 font-medium">Familia</th>
                <th className="py-2 text-right font-medium">Peso</th>
                <th className="py-2 pl-4 font-medium">Regla</th>
              </tr>
            </thead>
            <tbody>
              {xw.map((r, i) => (
                <tr key={i} className="border-b border-hairline last:border-0">
                  <td className="py-1.5">{r.partido_nombre}</td>
                  <td className="py-1.5 text-right">{num(r.votos_lista)}</td>
                  <td className="py-1.5 pl-4">
                    <span className="flex items-center gap-1.5">
                      <Dot familia={r.familia_id} size={8} />
                      {famPorId[r.familia_id]?.nombre_corto}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{r.peso < 1 ? pct(r.peso, 0) : '100 %'}</td>
                  <td className="py-1.5 pl-4 text-muted">{r.fuente.replace('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-5">
        <CardTitle title="4 · El modelo de pronóstico" subtitle="Qué hace, cómo se le puso a prueba y cuánta confianza merece." />
        <p className="text-[14px] leading-relaxed text-ink-2">
          El modelo responde una pregunta concreta:{' '}
          <strong className="text-ink">¿cuántas de las 44 curules del Concejo podría obtener cada familia política en 2027?</strong> Nadie puede saberlo con certeza, así que el resultado
          nunca es una cifra única, sino un rango con su probabilidad. Estos son los pasos:
        </p>
        <ol className="mt-4 space-y-4">
          <Paso n={1} titulo="Agrupar los partidos en familias">
            Los partidos cambian de nombre, se fusionan o se dividen, así que compararlos uno a uno entre elecciones no funciona. Cada lista se asigna a una de nueve «familias políticas» con
            continuidad en el tiempo (tabla de la sección 3). Es una agrupación para poder analizar; no significa que los partidos de una familia estén aliados.
          </Paso>
          <Paso n={2} titulo="Calcular el punto de partida de cada familia para 2027">
            Se estima cuánto podría sacar cada familia —su «cuota», es decir, su porcentaje de los votos válidos— a partir de lo que pasó en el Concejo 2023 y de cómo se movió el voto en las
            elecciones más recientes (Cámara, Senado y Presidencia 2026). Hay seis maneras de hacer ese cálculo, desde la más simple («repetir 2023») hasta la que sigue el rastro del voto entre
            elecciones.
          </Paso>
          <Paso n={3} titulo="Ponerlas a prueba contra el pasado">
            A cada método se le pidió «predecir» el Concejo 2023 usando únicamente lo que se sabía antes de esa elección, y se comparó con lo que realmente ocurrió. Ese examen se llama{' '}
            <em>backtest</em>. Se usa el método que menos se equivocó.
          </Paso>
          <Paso n={4} titulo="Agregar un margen de error realista">
            Ningún método acierta exacto. El margen se calcula a partir de cuánto han cambiado las familias de un Concejo al siguiente desde 2011, y se ensancha si el examen de 2023 muestra que
            era demasiado optimista (véase más abajo).
          </Paso>
          <Paso n={5} titulo={`Simular ${pro.n_simulaciones.toLocaleString('es-CO')} veces y repartir las curules`}>
            En cada simulación se sortean las cuotas dentro del margen de error, se reparten entre las listas de cada familia y se asignan las 44 curules con la fórmula que fija la ley
            (la cifra repartidora, con un umbral mínimo del 50&nbsp;% del cociente electoral). Lo que se publica es el rango de resultados de todas las repeticiones.
          </Paso>
        </ol>

        <h3 className="mt-9 text-[15px] font-semibold text-ink">El examen de 2023: seis métodos, un ganador</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Esta es la comparación. El <strong className="text-ink">error promedio</strong> dice cuántos puntos porcentuales se equivocó cada método, en promedio, al estimar la votación de cada
          familia en 2023 (si una familia sacó 13,6&nbsp;% y el método dijo 11,6&nbsp;%, el error es de 2 puntos). Mientras más bajo, mejor.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="tabular w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12px] text-muted">
                <th className="py-2 font-medium">Método</th>
                <th className="py-2 text-right font-medium">Error promedio</th>
                <th className="py-2 text-right font-medium">Curules de diferencia</th>
              </tr>
            </thead>
            <tbody>
              {metodos.map(([clave, m]) => (
                <tr key={clave} className="border-b border-hairline align-top last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-ink">{nombreMetodo(clave)}</span>
                    {clave === bt.elegido && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-[11px] text-plane">elegido</span>}
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted">{METODOS[clave]?.idea}</span>
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-right font-medium">{dec(m.mae_pp, 2)} pts</td>
                  <td className="py-2.5 text-right">{m.error_curules_familias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          «Curules de diferencia»: suma, entre familias, de la distancia entre las curules que asignó el método y las que realmente obtuvo cada una. Dos métodos pueden dar el mismo error
          promedio y repartir curules de forma distinta, porque la cifra repartidora premia a las listas grandes.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          {bt.elegido === 'persistencia' ? (
            <>El método más simple, repetir el Concejo 2023, fue el más preciso, así que es el que se usa como punto de partida.</>
          ) : (
            <>
              El método elegido, «{nombreMetodo(bt.elegido).toLowerCase()}», se equivocó {dec(ganador.mae_pp, 2)} puntos por familia; el punto de comparación más simple, repetir el Concejo
              2023, {dec(simple.mae_pp, 2)}.
            </>
          )}{' '}
          {mejorCurules[0] !== bt.elegido && (
            <>
              En curules, en cambio, «{nombreMetodo(mejorCurules[0]).toLowerCase()}» quedó más cerca ({mejorCurules[1].error_curules_familias} de diferencia frente a{' '}
              {ganador.error_curules_familias}). El criterio de selección es el error de votación; las curules solo desempatan.
            </>
          )}
        </p>
        <div className="mt-4">
          <Callout title="Cómo tomar este resultado">
            La ventaja del método elegido es modesta y sale de una sola prueba (2023). Además, el examen mostró fallas claras:{' '}
            {fuera80.length > 0 ? (
              <>
                el resultado real de {fuera80.length} de las 9 familias ({fuera80.map((f) => nombreFam(f.familia)).join(', ')}) cayó fuera del rango que el modelo daba como probable
              </>
            ) : (
              <>algunas familias quedaron cerca del borde del rango probable</>
            )}
            . Por eso el modelo no afirma una cifra exacta: entrega rangos y, junto a ellos, cuánto se equivocó cuando se le puso a prueba.
          </Callout>
        </div>

        <h3 className="mt-9 text-[15px] font-semibold text-ink">Cuánto margen de error tiene el pronóstico</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          En vez de decir «{famPorId[cabeza.id]?.nombre_corto} sacará {dec(cabeza.curules.p50, 0)} curules», el modelo dice: lo más probable es {dec(cabeza.curules.p50, 0)} y, en 8 de cada 10
          simulaciones, entre {dec(cabeza.curules.p10, 0)} y {dec(cabeza.curules.p90, 0)}. Ese rango sale de dos cosas:
        </p>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">La historia.</strong> Se mide cuánto han cambiado las familias de un Concejo al siguiente entre 2011 y 2023 ({v.n} cambios observados). Esa historia
            incluye sacudidas fuertes —como la del Nuevo Liberalismo en 2023— y el margen las tiene en cuenta: es más amplio de lo que sugeriría un cambio «típico».
          </li>
          <li>
            <strong className="text-ink">Una corrección tras el examen.</strong>{' '}
            {antes80 !== null && despues80 !== null ? (
              <>
                Al compararlo con lo que pasó en 2023, ese margen resultó demasiado optimista: los rangos que debían contener el resultado real 8 de cada 10 veces solo lo contuvieron{' '}
                {antes80} de cada 10. Por eso se ensancharon en un factor de ×{dec(bt.factor_calibracion, 2)}; con esa corrección, el mismo examen da {despues80} de cada 10.
              </>
            ) : (
              <>
                Al compararlo con lo que pasó en 2023, ese margen resultó demasiado optimista, así que se ensanchó en un factor de ×{dec(bt.factor_calibracion, 2)}.
              </>
            )}{' '}
            La misma corrección se aplica al pronóstico de 2027, por eso los rangos de la página son más anchos de lo que saldrían sin ella. Nunca se estrecha un rango: ante la duda, se prefiere
            ser prudente.
          </li>
        </ul>

        <h3 className="mt-9 text-[15px] font-semibold text-ink">Otras dos piezas del modelo</h3>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">Listas nuevas.</strong> Una lista que nunca compitió por el Concejo no tiene historial. Para «{meta.listas[pro.pronostico.emergente.id]?.nombre ?? 'la lista nueva'}» se
            parte de lo que sacó en la Cámara 2026 ({pct(pro.pronostico.emergente.cuota_base)}) y se lo convierte a lo que suele sacar una familia en el Concejo: en promedio, una familia saca en el Concejo
            cerca de {dec(pro.pronostico.conversion_camara_concejo.mediana, 2)} veces su porcentaje de la Cámara, con mucha variación de una familia a otra, y esa variación también se simula.
          </li>
          <li>
            <strong className="text-ink">Mapa 2027.</strong> La proyección por UPZ aplica el cambio de toda la ciudad a cada zona, pero conserva parte de la diferencia que esa zona ya tenía frente al
            promedio: una UPZ donde una familia era muy fuerte en 2023 sigue siendo comparativamente fuerte. Se conserva cerca del {pct(pro.beta_local, 0)} de esa diferencia, valor estimado entre 2019
            y 2023.
          </li>
        </ul>

        <Detalles titulo="Detalles técnicos del modelo (para quien quiera auditarlo)">
          <p>
            <strong className="text-ink">Escala.</strong> Las cuotas de las nueve familias y del voto en blanco se modelan en escala logit, una transformación que impide porcentajes negativos o
            mayores a 100 y trata igual un cambio de 2 a 4&nbsp;% que uno de 20 a 40&nbsp;%.
          </p>
          <p>
            <strong className="text-ink">Reglas con coeficiente κ.</strong> «Trasladar parte del cambio…» suma al logit del Concejo anterior una fracción κ del cambio logit observado en la Cámara
            (κ = {dec(bt.kappa.kappa_mco, 2)} por mínimos cuadrados 2018→2022 vs. Concejo 2019→2023; en el backtest se usa κ dejando una familia fuera cada vez, y se limita a [0, 1] para que nunca
            amplifique un cambio en dirección contraria). La versión presidencial da κ negativo y, con esa salvaguarda, queda idéntica a repetir el Concejo anterior.
          </p>
          <p>
            <strong className="text-ink">Ruido.</strong> Los cambios logit de las familias establecidas entre 2011, 2015, 2019 y 2023 ({v.n} observaciones) se ajustan por máxima verosimilitud a una t de
            Student centrada en cero: ν = {dec(v.nu, 1)} y escala {dec(v.escala_t, 3)}. Las colas pesadas permiten choques como el del Nuevo Liberalismo. La calibración ensancha esa escala (factor
            ×{dec(pro.pronostico.factor_calibracion, 2)}, hasta {dec(pro.pronostico.escala_calibrada, 3)}) tomando el cuantil del 80&nbsp;% de los residuos del backtest, a la manera de la predicción
            conforme; nunca la reduce por debajo de la escala original.
          </p>
          <p>
            <strong className="text-ink">Reparto interno.</strong> Dentro de cada familia, una Dirichlet (concentración 25) centrada en la votación de 2023 reparte la cuota entre sus listas; el umbral
            es el 50&nbsp;% del cociente electoral (≈1,14&nbsp;% de los votos válidos con 44 curules). Semilla fija, {pro.n_simulaciones.toLocaleString('es-CO')} simulaciones.
          </p>
        </Detalles>

        <div className="mt-6">
          <Callout title="Límites">
            Solo hay cuatro elecciones de Concejo comparables y la unidad de análisis es la familia, así que la incertidumbre es grande y así se presenta. El modelo no conoce las listas definitivas de
            2027, ni candidaturas a la Alcaldía, ni encuestas. Las familias políticas son una agrupación analítica: no implican alianzas entre partidos.
          </Callout>
        </div>
      </Card>

      <Card className="mt-5 scroll-mt-6">
        <span id="matriz-transferencia" className="-mt-6 block h-0" aria-hidden />
        <CardTitle
          title="5 · ¿A dónde se va el voto? La matriz de transferencia"
          subtitle="Cuando una familia política pierde votos, ¿quién los recibe? Aquí se explica cómo se estimó y cómo leer el resultado."
        />
        {trans && mCam ? (
          <>
            <h3 className="text-[15px] font-semibold text-ink">El problema</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              El voto es secreto: nunca sabemos si quien votó por un partido en una elección votó por otro en la siguiente. Lo que la Registraduría sí publica es el resultado de cada puesto de
              votación. Si en los puestos donde una familia era fuerte otra creció más, eso es una pista —no una prueba— de que parte de ese voto se movió. Cada uno de los cerca de {num(mCam.n_puestos)} puestos
              de Bogotá es una pista de este tipo, y un método estadístico (la «inferencia ecológica») las combina para estimar qué parte del voto de cada familia se quedó y qué parte
              pasó a cada una de las demás. El resultado es una tabla llamada <strong className="text-ink">matriz de transferencia</strong>.
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              Es un trabajo de detective con pistas indirectas: da un panorama razonable de hacia dónde se mueve el voto, pero no es una encuesta ni el testimonio de los votantes.
            </p>

            {ejemplo && (
              <>
                <h3 className="mt-8 text-[15px] font-semibold text-ink">Un ejemplo con datos reales</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  Tomemos a Alianza Verde. Según la matriz Cámara 2022 → 2026, de cada 100 votos que tuvo Alianza Verde en la Cámara 2022, unos <strong className="text-ink">{ejemplo.queda} se quedaron</strong> en
                  Alianza Verde;{' '}
                  {ejemplo.top.map((o, k) => (
                    <span key={o.categoria}>
                      {k > 0 && (k === ejemplo.top.length - 1 ? ' y ' : ', ')}
                      <strong className="text-ink">{Math.round(o.p * 100)}</strong> pasaron {haciaTexto(o.categoria, nombreFam(o.categoria))}
                    </span>
                  ))}
                  ; el resto se repartió entre las demás. Así, cuando el pronóstico supone que una familia pierde fuerza, no reparte esos votos por igual entre todos: los manda hacia donde el
                  patrón observado dice que suelen ir.
                </p>
              </>
            )}

            <h3 className="mt-8 text-[15px] font-semibold text-ink">Explore las matrices</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              Se calcularon cinco matrices, una por cada par de elecciones que se puede comparar. Elija una para ver cómo se movió el voto de cada familia.
            </p>
            <div className="mt-4 rounded-2xl border border-hairline p-4 sm:p-5">
              <FlujoVotos trans={trans} elegido={bt.elegido} famPorId={famPorId} />
            </div>

            <h3 className="mt-8 text-[15px] font-semibold text-ink">Qué se hizo con ellas</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">Dos maneras de usar las elecciones anteriores.</strong> Las matrices <em>Cámara → Cámara</em> miden cómo se movió el voto entre dos elecciones de Cámara,
                y ese movimiento se traslada al Concejo. El <em>puente presidencial → Concejo</em> aprovecha el calendario: la presidencial (mayo o junio) llega unos 16 meses antes que el Concejo
                (octubre del año siguiente), así que su resultado es una lectura de «la tendencia del momento». Se aprende cómo se tradujo el voto presidencial en voto al Concejo en el ciclo
                anterior y se aplica ese puente a la presidencial más reciente.
              </li>
              <li>
                <strong className="text-ink">Para el examen de 2023</strong> solo se usa información anterior a 2023 (de lo contrario sería trampa): la matriz Cámara 2018 → 2022 y el puente
                presidencial 2018 → Concejo 2019 aplicado a la presidencial de 2022. Las presidenciales de 2026 no entran aquí, porque son posteriores.
              </li>
              <li>
                <strong className="text-ink">Para el pronóstico de 2027</strong> se repite lo mismo un ciclo después: la matriz Cámara 2022 → 2026, aplicada a los resultados del Concejo 2023, y el puente
                presidencial 2022 → Concejo 2023 aplicado a la presidencial de 2026, que es la tendencia actual. El supuesto es fuerte y conviene decirlo: que lo que pasó en el ciclo anterior se
                repetirá en este.
              </li>
              <li>
                <strong className="text-ink">Concejo 2019 → 2023</strong> se publica solo como referencia: ya contiene el resultado de 2023, y usarla en el examen equivaldría a copiar del cuaderno de
                respuestas.
              </li>
            </ul>

            <h3 className="mt-8 text-[15px] font-semibold text-ink">¿Funcionó?</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              Se probaron dos maneras de usar los datos, una con la Cámara y otra con las presidenciales. Estos fueron sus resultados en el examen de 2023 (tabla de la sección 4):
            </p>
            <ul className="mt-2 list-disc space-y-2.5 pl-5 text-[14px] leading-relaxed text-ink-2">
              {mMat && (
                <li>
                  <strong className="text-ink">Con datos de la Cámara, sí.</strong> Error de {dec(mMat.mae_pp, 2)} puntos por familia, lugar {puesto('transferencia_matriz')} de {metodos.length}; repetir el
                  Concejo 2023 dio {dec(simple.mae_pp, 2)}. {bt.elegido === 'transferencia_matriz' ? 'Por eso es la que alimenta el pronóstico. ' : ''}Aun así no acertó a todas las familias.
                </li>
              )}
              {mKapPres && (
                <li>
                  <strong className="text-ink">«Trasladar parte del cambio presidencial»: empata con repetir 2023.</strong> No es un error de cálculo. La relación entre cómo cambió la votación en
                  las presidenciales y cómo cambió en el Concejo salió en sentido contrario al esperado, y el método incluye una regla de seguridad —nunca amplificar un cambio en dirección
                  contraria— que lo deja en cero. No se relajó esa regla para forzar que «ganara».
                </li>
              )}
              {mMatPres && (
                <li>
                  <strong className="text-ink">
                    «{nombreMetodo('transferencia_matriz_presidencial')}»: {mMatPres.mae_pp < simple.mae_pp ? 'mejora a repetir 2023' : 'no supera a repetir 2023'}.
                  </strong>{' '}
                  Error de {dec(mMatPres.mae_pp, 2)} puntos por familia, lugar {puesto('transferencia_matriz_presidencial')} de {metodos.length}. Es la versión que sigue el calendario
                  electoral: se aprende cómo el voto presidencial de 2018 se convirtió en voto al Concejo de 2019 y se aplica esa traducción a la presidencial de 2022 (la última anterior a 2023). Hay
                  dos razones por las que no funciona mejor:
                  <ul className="mt-1.5 list-[circle] space-y-1.5 pl-5">
                    <li>
                      <strong className="text-ink">El puente se aprende bien pero no se traslada de un ciclo al siguiente.</strong>{' '}
                      {bt.puente_presidencial_mae_mismo_ciclo_pp != null && <>Reproduce el ciclo donde se aprendió con un error de solo {dec(bt.puente_presidencial_mae_mismo_ciclo_pp, 2)} puntos, pero al aplicarlo a 2022 el error sube a {dec(mMatPres.mae_pp, 2)}. </>}
                      Entre 2018 y 2022 cambiaron los candidatos: Liberal y CR · MIRA · U dejaron de llevar candidato propio, y el bloque «otros» pasó de ser sobre todo Fajardo a ser sobre todo
                      Rodolfo Hernández, un electorado distinto.
                    </li>
                    <li>
                      <strong className="text-ink">Los partidos sin candidato presidencial son invisibles para este método.</strong>{' '}
                      {nl && (
                        <>
                          Nuevo Liberalismo sacó {pct(nl.real_cuota)} en el Concejo 2023 y no tuvo votación propia en la presidencial de 2022: el método le asigna {pct(mMatPres.cuotas.nuevo_liberalismo)}.{' '}
                        </>
                      )}
                      Ese caso pesa mucho en el error de todos los métodos, y es justo donde la presidencial no puede ayudar.
                    </li>
                  </ul>
                </li>
              )}
            </ul>

            <div className="mt-5">
              <Callout title="Cómo interpretar estas matrices con cuidado">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>Son estimaciones estadísticas, no encuestas: nadie le preguntó a los votantes por quién votó antes.</li>
                  <li>
                    Léalas como tendencias entre puestos de votación, no como personas.{' '}
                    {flujoPronostico && (
                      <>
                        Por ejemplo, la mayor transferencia entre familias distintas en la matriz del pronóstico es {nombreFam(flujoPronostico.origen)} → {nombreFam(flujoPronostico.destino)}:{' '}
                        {Math.round(flujoPronostico.p * 100)}&nbsp;%. Léase como «en los puestos donde {nombreFam(flujoPronostico.origen)} pesaba en 2022, {nombreFam(flujoPronostico.destino)} ganó
                        terreno en 2026», no como «el {Math.round(flujoPronostico.p * 100)}&nbsp;% de los votantes de {nombreFam(flujoPronostico.origen)} cambió de bando».
                      </>
                    )}
                  </li>
                  <li>
                    Un solo examen (2023) decidió qué método usar. Si el patrón entre 2022 y 2026 cambia de aquí a 2027, el pronóstico también cambiaría; por eso los rangos son amplios.
                  </li>
                  <li>
                    Las filas «sin datos» no significan que ese voto no se mueva, sino que estos datos no permiten saber hacia dónde.
                  </li>
                </ul>
              </Callout>
            </div>

            <Detalles titulo="Detalles técnicos de la estimación (para quien quiera auditarla)">
              <p>
                <strong className="text-ink">Modelo.</strong> Para cada puesto de votación, los votos por categoría en la elección de destino se modelan con una distribución Dirichlet-Multinomial cuya
                media es la mezcla esperada: la composición de origen del puesto multiplicada por la matriz global (cada fila con prior Dirichlet(1), es decir, parejo). Una concentración κ
                ~ Gamma(2; 0,01) absorbe cuánto se aparta cada puesto de esa mezcla. Se muestrea con NUTS (PyMC), 2 cadenas de 900 iteraciones tras 900 de calentamiento.
              </p>
              <p>
                Es una versión más liviana que la inferencia ecológica RxC completa (Rosen, Jiang, King y Tanner), que además muestrearía la tabla cruzada latente de cada puesto; sigue siendo
                bayesiana: el resultado es una distribución completa sobre la matriz, no un solo número. Los rangos que se muestran son intervalos de credibilidad del 90&nbsp;% (percentiles 5 y 95).
              </p>
              <p>
                <strong className="text-ink">Identificación.</strong> Depende de que la composición de cada puesto varíe lo suficiente entre elecciones: si todos los puestos votaran igual, ningún
                volumen de datos permitiría distinguir «todos se quedan» de «todos rotan en la misma proporción».
              </p>
              <div className="overflow-x-auto">
                <table className="tabular w-full min-w-[520px] text-[12px]">
                  <thead>
                    <tr className="border-b border-hairline text-left text-muted">
                      <th className="py-1.5 font-medium">Par de elecciones</th>
                      <th className="py-1.5 text-right font-medium">Puestos</th>
                      <th className="py-1.5 text-right font-medium">Concentración κ</th>
                      <th className="py-1.5 text-right font-medium">R-hat máx.</th>
                      <th className="py-1.5 text-right font-medium">ESS mín.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(trans).map(([k, m]) => (
                      <tr key={k} className="border-b border-hairline last:border-0">
                        <td className="py-1.5">{ETIQUETA_PAR[k] ?? k}</td>
                        <td className="py-1.5 text-right">{num(m.n_puestos)}</td>
                        <td className="py-1.5 text-right">{dec(m.kappa_media, 0)}</td>
                        <td className="py-1.5 text-right">{dec(m.rhat_max, 3)}</td>
                        <td className="py-1.5 text-right">{dec(m.ess_min, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted">
                R-hat cercano a 1 y ESS de cientos o más indican que las dos cadenas del algoritmo llegan a la misma respuesta y que hay suficientes muestras independientes. La matriz completa, con
                sus intervalos, está en <code className="rounded bg-surface-2 px-1 py-0.5">data/processed/transferencia.json</code>.
              </p>
            </Detalles>
          </>
        ) : (
          <p className="text-[14px] text-muted">
            Todavía no se corrió <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">python -m pipeline.transferencia</code> en este build de datos.
          </p>
        )}
      </Card>

      <Card className="mt-5">
        <CardTitle
          title="6 · Escenarios con hipótesis: ¿y si…?"
          subtitle="Qué pasaría si una hipótesis política fuera cierta. Siempre se rotula como supuesto, nunca como pronóstico."
        />
        <p className="text-[14px] leading-relaxed text-ink-2">
          El pronóstico base sale únicamente de los datos. Pero quienes conocen la política de la ciudad tienen hipótesis que los datos históricos no pueden contener; por ejemplo: «Alianza Verde se
          debilita y sus votantes se reparten entre un partido nuevo y otras familias». Los escenarios permiten preguntar: si eso fuera cierto, ¿cuántas curules saldrían?
        </p>
        <ol className="mt-4 space-y-4">
          <Paso n={1} titulo="Alguien del equipo plantea la hipótesis con sus palabras">
            Por ejemplo, qué familia se debilita, qué partido nuevo aparece y de dónde vendría su votación.
          </Paso>
          <Paso n={2} titulo="Se traduce a una ficha de parámetros">
            La ficha dice qué porcentaje del voto de cada familia se mueve a cuál otra, y qué partidos nuevos aparecen y con qué fuerza. Esa traducción puede hacerla una IA, pero solo eso: traduce texto
            a parámetros.
          </Paso>
          <Paso n={3} titulo="Una persona revisa y aprueba la ficha">
            Lo que queda registrado y se puede auditar es la ficha, no el texto original. El sistema verifica automáticamente que los porcentajes de cada fila sumen 100&nbsp;%: nadie puede «crear»
            votos de la nada.
          </Paso>
          <Paso n={4} titulo="Se corre la misma simulación de siempre">
            Con la ficha aprobada se ejecutan las mismas {pro.n_simulaciones.toLocaleString('es-CO')} simulaciones y el mismo reparto legal de curules del pronóstico base. La IA nunca calcula votos ni
            curules.
          </Paso>
          <Paso n={5} titulo="El resultado se muestra rotulado como hipótesis">
            Aparece en la página del Pronóstico, seleccionable y claramente marcado como escenario del equipo.
          </Paso>
        </ol>
        <div className="mt-5">
          <Callout title="Por qué esta separación">
            Para que el observatorio se mantenga neutral. El pronóstico por defecto lo decide el examen de 2023 (sección 4), no una opinión; los escenarios son un complemento etiquetado, que no
            compitió en ese examen y no lo reemplaza.
          </Callout>
        </div>
        {Object.keys(escenariosIA).length > 0 ? (
          <div className="mt-5">
            <p className="eyebrow">Escenarios disponibles</p>
            <ul className="mt-2 space-y-1.5">
              {Object.values(escenariosIA).map((e) => (
                <li key={e.id} className="text-[13px]">
                  <span className="font-semibold text-ink">{e.nombre}</span>{' '}
                  <a className="link-underline text-muted" href="/pronostico">
                    ver en el pronóstico →
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-[14px] text-muted">
            Todavía no hay ningún escenario en <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">reference/escenarios/</code> en este build de datos.
          </p>
        )}
      </Card>

      <Card className="mt-5">
        <CardTitle title="Glosario" subtitle="Los términos que aparecen en esta página y en el resto del observatorio." />
        <dl className="grid gap-x-8 gap-y-3 text-[13px] leading-relaxed md:grid-cols-2">
          {GLOSARIO.map(([t, d]) => (
            <div key={t}>
              <dt className="font-semibold text-ink">{t}</dt>
              <dd className="text-ink-2">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-5">
        <CardTitle title="Reproducir" subtitle="Requisitos: Python 3.12 y Node 20 o superior." />
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-4 text-[12px] leading-relaxed text-ink">
          {`python -m pipeline.external      # descarga ya hecha: filtra Congreso y Presidencia a Bogotá
python -m pipeline.ingest        # limpieza del Concejo y del censo
python -m pipeline.aggregate     # familias, geocodificación, curules (valida contra lo oficial)
python -m pipeline.analysis      # participación, fragmentación, LISA, candidatos, demografía
python -m pipeline.transferencia # matriz de transferencia bayesiana (opcional, tarda; MCMC sobre los puestos)
python -m pipeline.model         # backtest 2023 + pronóstico 2027
python -m pipeline.escenarios    # escenarios con hipótesis (opcional; requiere pipeline.model primero)
python -m pipeline.export        # JSON para la web
pytest && (cd web && npx vitest run && npm run build)`}
        </pre>
      </Card>

      <p className="mt-8 text-[13px] text-muted">
        Fuentes: Registraduría Nacional del Estado Civil —{' '}
        <a className="link-underline" href="https://observatorio.registraduria.gov.co/views/electoral/historicos-resultados.php" target="_blank" rel="noreferrer">
          histórico de resultados
        </a>{' '}
        y censo electoral por puesto—;{' '}
        <a className="link-underline" href="https://www.datos.gov.co/Resultados-Electorales/RESULTADOS-ELECTORALES-2018-CAMARA-DE-REPRESENTANT/vkjr-c6fe" target="_blank" rel="noreferrer">
          Datos Abiertos Colombia
        </a>
        ; catálogo georreferenciado de puestos y UPZ de Bogotá. Validación de curules frente a la composición publicada del Concejo.
      </p>
    </div>
  )
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1.5 text-ink-2">{k}</td>
      <td className="py-1.5 text-right font-medium">{v}</td>
    </tr>
  )
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-plane">{n}</span>
      <div className="text-[14px] leading-relaxed text-ink-2">
        <p className="font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </li>
  )
}

/** Bloque desplegable para el detalle matemático: está a la vista para auditarlo, pero no estorba a quien no lo necesita. */
function Detalles({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="mt-6 rounded-xl border border-hairline">
      <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-semibold text-ink">{titulo}</summary>
      <div className="space-y-3 border-t border-hairline px-4 py-4 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </details>
  )
}
