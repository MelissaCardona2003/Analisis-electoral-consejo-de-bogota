import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Callout, Card, CardTitle, Dot, SectionHeader } from '../components/ui'
import { dec, num, pct } from '../lib/format'
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

export default function Metodologia() {
  const { famPorId } = useMeta()
  const cal = useJson<Calidad>('calidad.json')
  const pro = useJson<Pronostico>('pronostico.json')
  const trans = useJson<TransferenciaOut>('transferencia.json')
  const escenariosIA = useJson<EscenariosIAOut>('escenarios_ia.json')
  const [eleccionXw, setEleccionXw] = useState('camara_2026')
  const xw = useMemo(() => cal.crosswalk.filter((r) => r.eleccion === eleccionXw).sort((a, b) => b.votos_lista - a.votos_lista), [cal, eleccionXw])
  const v = pro.pronostico.volatilidad
  const i19 = cal.ingesta['2019']
  const i23 = cal.ingesta['2023']

  return (
    <div>
      <SectionHeader
        eyebrow="Metodología y calidad de datos"
        title="Cómo se hizo, paso a paso"
        lede="Todo el análisis es reproducible desde los archivos oficiales. Esta página documenta la limpieza de los datos, las validaciones que tuvieron que pasar y el modelo, incluidos sus límites."
      />

      <Card>
        <CardTitle title="Validaciones" subtitle="Controles automáticos (pytest y vitest) que debe superar el pipeline antes de publicar." />
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            `El motor de cifra repartidora reproduce la composición oficial del Concejo en 2011, 2015, 2019 y 2023.`,
            `El reparto en TypeScript (simulador) da exactamente lo mismo que el de Python en 2019 y 2023.`,
            `Censo electoral: hombres + mujeres = potencial y rangos de edad + extranjeros = potencial en los ${num(cal.censo['2019'].puestos + cal.censo['2023'].puestos)} puestos.`,
            `Todos los puestos con votos al Concejo tienen censo y viceversa (${cal.censo['2019'].puestos} en 2019, ${cal.censo['2023'].puestos} en 2023).`,
            `Votos del Concejo 2019 cuadran con el escrutinio oficial (p. ej. voto en blanco 529.514, nulos 112.118).`,
            `Normalización de texto probada contra mojibake, espacios invisibles y palabras partidas.`,
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
          <CardTitle title="1 · Ingesta y limpieza" subtitle="Los archivos venían con codificaciones y convenciones distintas." />
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
          <p className="mt-5 eyebrow">Geocodificación de puestos</p>
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
          <p className="mt-2 text-[12px] text-muted">Confianza alta: similitud del nombre ≥ 86 sobre 100 dentro de la misma localidad.</p>
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
        <CardTitle title="4 · El modelo de pronóstico" />
        <div className="grid gap-6 text-[14px] leading-relaxed text-ink-2 lg:grid-cols-2">
          <div className="space-y-4">
            <p>
              <strong className="text-ink">Unidad.</strong> La cuota de votos válidos (incluido el blanco) de nueve familias políticas en toda la ciudad, en escala logit. Las curules se
              calculan después, lista por lista.
            </p>
            <p>
              <strong className="text-ink">Centro.</strong> Se comparan cinco reglas pronosticando 2023 con información previa: repetir el Concejo anterior, trasladar el cambio de la
              Cámara (swing uniforme), transferirlo en escala logit con un coeficiente κ (una vez calibrado con Cámara y otra vez con la primera vuelta presidencial), y una matriz de
              transferencia entre familias estimada por inferencia ecológica bayesiana (regresión ecológica con verosimilitud Dirichlet-Multinomial sobre los puestos, ver{' '}
              <a className="link-underline" href="#matriz-transferencia">más abajo</a>). La elegida fue <em>{pro.pronostico.nombre_regla.toLowerCase()}</em>, la de menor error (
              {dec(pro.backtest.metricas[pro.backtest.elegido].mae_pp, 2)} puntos por familia); las demás quedan disponibles como escenarios alternativos. La regla presidencial, con los
              datos actuales, empata exactamente con persistencia: solo 4 de las 10 categorías tienen candidatura presidencial propia comparable en las cuatro elecciones necesarias, y la
              relación estimada entre el cambio presidencial y el cambio del Concejo sale de signo negativo — la salvaguarda que ya usa la regla de κ (nunca amplificar en la dirección
              contraria) la deja en cero. No se relajó esa salvaguarda para forzar que la regla "gane": se documenta el resultado tal como salió.
            </p>
            <p>
              <strong className="text-ink">Incertidumbre.</strong> Los cambios logit de las familias establecidas entre 2011, 2015, 2019 y 2023 ({v.n} observaciones) se ajustan por
              máxima verosimilitud a una t de Student centrada en cero: ν = {dec(v.nu, 1)} grados de libertad y escala {dec(v.escala_t, 3)}. Las colas pesadas permiten choques como
              el del Nuevo Liberalismo en 2023.
            </p>
          </div>
          <div className="space-y-4">
            <p>
              <strong className="text-ink">Listas nuevas.</strong> La Lista de Oviedo no tiene historial en el Concejo: su cuota se simula como su votación en Cámara 2026 (
              {pct(pro.pronostico.emergente.cuota_base)}) multiplicada por una tasa de conversión log-normal estimada entre familias (mediana ×
              {dec(pro.pronostico.conversion_camara_concejo.mediana, 2)}, desviación log {dec(pro.pronostico.conversion_camara_concejo.sd_log, 2)}).
            </p>
            <p>
              <strong className="text-ink">Simulación.</strong> En cada una de las {pro.n_simulaciones.toLocaleString('es-CO')} simulaciones se sortean las cuotas, se reparten dentro de
              cada familia con una Dirichlet centrada en 2023, se aplica el umbral y se asignan 44 curules por cifra repartidora.
            </p>
            <p>
              <strong className="text-ink">Mapa 2027.</strong> La proyección por UPZ aplica el cambio de ciudad y conserva la diferencia local de 2023 con un factor de persistencia β ={' '}
              {dec(pro.beta_local, 2)} estimado entre 2019 y 2023.
            </p>
          </div>
        </div>
        <div className="mt-6">
          <Callout title="Límites">
            Solo hay cuatro elecciones de Concejo comparables y la unidad de cambio es la familia, así que la incertidumbre es grande y así se presenta. El modelo no conoce las listas
            definitivas de 2027, ni candidaturas a la Alcaldía, ni encuestas. Las familias políticas son una agrupación analítica: no implican alianzas entre partidos.
          </Callout>
        </div>
      </Card>

      <Card className="mt-5 scroll-mt-6">
        <span id="matriz-transferencia" className="-mt-6 block h-0" aria-hidden />
        <CardTitle
          title="5 · Matriz de transferencia entre familias"
          subtitle="La pregunta que no responde el swing uniforme: ¿a dónde se va el voto cuando una familia pierde fuerza?"
        />
        {trans ? (
          <>
            <p className="text-[14px] leading-relaxed text-ink-2">
              Nunca se observa a una persona votando por una familia en una elección y por otra en la siguiente: solo se conocen, por puesto, los totales de cada familia en cada
              elección. Para inferir el flujo entre familias se ajustó una regresión ecológica bayesiana: cada puesto aporta un término de verosimilitud Dirichlet-Multinomial
              centrado en la mezcla esperada de destino —la combinación de las filas de la matriz global ponderada por la composición de origen de ese puesto—, con una
              concentración κ que absorbe cuánto se aparta cada puesto de esa mezcla. Es una versión más liviana que la inferencia ecológica "RxC" completa (que muestrearía la
              tabla cruzada latente de cada puesto), pero sigue siendo genuinamente bayesiana: hay un posterior completo sobre la matriz, no un solo número.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              Se estimó tres veces, de forma independiente, porque el pronóstico y su backtest no pueden usar la misma matriz: la de Concejo 2019→2023 conoce la respuesta que
              se le pediría "predecir" (usarla en el backtest sería circular), así que el backtest compite con una matriz de Cámara 2018→2022 —anterior a 2023, como las otras
              tres reglas— y el pronóstico 2027 usa la más reciente, Cámara 2022→2026.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['concejo_2019_2023', 'Concejo 2019 → 2023', 'Comparación publicada'],
                  ['camara_2018_2022', 'Cámara 2018 → 2022', pro.backtest.matriz_usada === 'camara_2018_2022' ? 'Usada en el backtest' : 'Calculada para el backtest'],
                  ['camara_2022_2026', 'Cámara 2022 → 2026', pro.pronostico.matriz_usada === 'camara_2022_2026' ? 'Usada en el pronóstico 2027' : 'Calculada para el pronóstico'],
                ] as const
              ).map(([key, label, rol]) => {
                const m = trans[key]
                return m ? (
                  <div key={key} className="rounded-xl border border-hairline p-4">
                    <p className="eyebrow">{label}</p>
                    <p className="text-[11px] text-muted">{rol}</p>
                    <p className="mt-1 text-[13px] text-muted">
                      {num(m.n_puestos)} puestos · κ≈{dec(m.kappa_media, 0)} · R-hat máx {dec(m.rhat_max, 3)} · ESS mín {dec(m.ess_min, 0)}
                    </p>
                    <p className="mt-3 text-[12px] font-semibold text-ink-2">Se queda en la misma familia</p>
                    <ul className="mt-1.5 space-y-1">
                      {m.categorias.map((cat, i) => (
                        <li key={cat} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-[13px]">
                          <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                            <Dot familia={cat} size={8} />
                            <span className="truncate">{cat === 'blanco' ? 'Blanco' : (famPorId[cat]?.nombre_corto ?? cat)}</span>
                          </span>
                          <span className="h-1.5 rounded-full bg-surface-2">
                            <span className="block h-full rounded-full bg-ink" style={{ width: `${m.media[i][i] * 100}%` }} />
                          </span>
                          <span className="tabular text-right">{pct(m.media[i][i], 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              })}
            </div>
            <div className="mt-4">
              <Callout title="Límites de la inferencia ecológica">
                La matriz completa —con intervalos de credibilidad al 90&nbsp;%, no solo el promedio— queda en{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">data/processed/transferencia.json</code>. Como toda inferencia ecológica, la identificación
                depende de que la composición de cada puesto varíe lo suficiente entre elecciones: si todos los puestos votaran igual, ningún volumen de datos podría distinguir
                "todos se quedan" de "todos rotan en la misma proporción". Por eso importan los intervalos, no solo el promedio. La matriz de Cámara 2018→2022 solo entra al
                pronóstico base si mejora el error del backtest sobre 2023 frente a las otras cuatro reglas de arriba; si no lo mejora, queda disponible como escenario
                alternativo, nunca oculta.
              </Callout>
            </div>
          </>
        ) : (
          <p className="text-[14px] text-muted">
            Todavía no se corrió <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">python -m pipeline.transferencia</code> en este build de datos.
          </p>
        )}
      </Card>

      <Card className="mt-5">
        <CardTitle
          title="6 · Escenarios con hipótesis"
          subtitle="El rol acotado de la IA: traduce una hipótesis en prosa a parámetros, nunca estima curules."
        />
        <p className="text-[14px] leading-relaxed text-ink-2">
          Cuando alguien del equipo plantea una hipótesis política —"Alianza Verde se debilita y surge un partido nuevo", por ejemplo— esa hipótesis se traduce a
          un archivo YAML declarativo en <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">reference/escenarios/</code>: qué fracción del voto de
          una familia se mueve a cuál otra o a qué lista nueva, con validación automática de que cada fila sume 1 (conservación de masa) antes de aceptarla. Un
          humano revisa y aprueba ese YAML — es el artefacto auditable, no la prosa original ni el criterio de quien la tradujo.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          A partir de ahí no hay nada especial: el escenario ajusta la cuota de entrada del mismo Monte Carlo y la misma cifra repartidora que calculan el
          pronóstico base — la IA nunca estima un número de curules directamente. El resultado se muestra siempre rotulado como hipótesis, seleccionable, nunca
          como el pronóstico por defecto (ese lo decide el backtest de la sección 5).
        </p>
        {Object.keys(escenariosIA).length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {Object.values(escenariosIA).map((e) => (
              <li key={e.id} className="text-[13px]">
                <span className="font-semibold text-ink">{e.nombre}</span>{' '}
                <a className="link-underline text-muted" href="/pronostico">
                  ver en el pronóstico →
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[14px] text-muted">
            Todavía no hay ningún YAML en <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">reference/escenarios/</code> en este build de datos.
          </p>
        )}
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
