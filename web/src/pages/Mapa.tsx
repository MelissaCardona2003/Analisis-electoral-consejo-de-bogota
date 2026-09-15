import { geoCentroid, interpolateLab } from 'd3'
import type { FeatureCollection, Geometry } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MLMap, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTemaEfectivo } from '../components/ThemeToggle'
import { FloatingTip, TipRow, type TipState } from '../components/Tooltip'
import { Callout, Card, CardTitle, Dot, SectionHeader, Segmented, famColor } from '../components/ui'
import { num, pct, pp } from '../lib/format'
import type { CapaFila, Capas, Puestos } from '../lib/types'
import { useJson, useMeta } from '../lib/useJson'

type Variable = 'ganador' | 'familia' | 'participacion' | 'blanco' | 'cambio' | 'bastiones'
type Nivel = 'upz' | 'localidad'
type Props = { cod: string; nombre: string; localidad: number }

/** Estilo propio sin mapa base externo: el territorio lo dibujan las UPZ y las localidades (sin claves ni terceros). */
function estiloBase(fondo: string): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': fondo } }] }
}
const ELECCIONES = [
  { value: 'concejo_2023', label: 'Concejo 2023' },
  { value: 'concejo_2019', label: 'Concejo 2019' },
  { value: 'proyeccion_2027', label: 'Proyección 2027' },
  { value: 'camara_2026', label: 'Cámara 2026' },
  { value: 'camara_2022', label: 'Cámara 2022' },
  { value: 'presidente_2026', label: 'Presidencia 2026' },
  { value: 'presidente_2022', label: 'Presidencia 2022' },
]
const VARIABLES: { value: Variable; label: string }[] = [
  { value: 'ganador', label: 'Familia más votada' },
  { value: 'familia', label: 'Fuerza de una familia' },
  { value: 'participacion', label: 'Participación' },
  { value: 'blanco', label: 'Voto en blanco' },
  { value: 'cambio', label: 'Cambio 2019→2023' },
  { value: 'bastiones', label: 'Bastiones (LISA)' },
]
const LISA = ['alto-alto', 'alto-bajo', 'bajo-alto', 'bajo-bajo', 'no_significativo']
const LISA_LABEL: Record<string, string> = {
  'alto-alto': 'Bastión: alto rodeado de alto',
  'alto-bajo': 'Isla fuerte: alto rodeado de bajo',
  'bajo-alto': 'Hueco: bajo rodeado de alto',
  'bajo-bajo': 'Zona débil: bajo rodeado de bajo',
  no_significativo: 'Sin patrón significativo',
}

// MapLibre v6 crea su web worker como módulo relativo a su propio archivo; al empaquetar con Vite esa ruta se pierde y
// las fuentes GeoJSON nunca cargan. El worker y su chunk compartido se sirven desde public/maplibre
// (los copia scripts/copiar-worker.mjs antes de `dev` y `build`).
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`)

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

export default function Mapa() {
  const { familias, famPorId, meta } = useMeta()
  const capas = useJson<Capas>('capas.json')
  const upzGeo = useJson<FeatureCollection<Geometry, Props>>('upz.geojson')
  const locGeo = useJson<FeatureCollection<Geometry, { localidad: number; nombre: string }>>('localidades.geojson')
  const puestos = useJson<Puestos>('puestos_2023.json')
  const tema = useTemaEfectivo()

  const [eleccion, setEleccion] = useState('concejo_2023')
  const [variable, setVariable] = useState<Variable>('ganador')
  const [familia, setFamilia] = useState('pacto_historico')
  const [nivel, setNivel] = useState<Nivel>('upz')
  const [verPuestos, setVerPuestos] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const mapa = useRef<MLMap | null>(null)
  const eventos = useRef(false)
  const [estiloListo, setEstiloListo] = useState(0)

  const esConcejo = eleccion.startsWith('concejo')
  const efectiva: Variable =
    (variable === 'participacion' && !esConcejo) || (variable === 'bastiones' && nivel === 'localidad') ? 'ganador' : variable
  const eleccionDatos = efectiva === 'cambio' || efectiva === 'bastiones' ? 'concejo_2023' : eleccion
  const nivelDatos: Nivel = eleccion === 'proyeccion_2027' ? 'upz' : nivel

  // paleta leída de los tokens CSS del tema activo (MapLibre necesita colores concretos)
  const pal = useMemo(() => {
    void tema
    const fam = Object.fromEntries(familias.map((f) => [f.id, cssVar(`--fam-${f.id}`)]))
    const seq = Array.from({ length: 8 }, (_, i) => cssVar(`--seq-${i}`))
    const div = ['--div-neg-3', '--div-neg-2', '--div-neg-1', '--div-mid', '--div-pos-1', '--div-pos-2', '--div-pos-3'].map(cssVar)
    return { fam, seq, div, surface: cssVar('--surface'), surface2: cssVar('--surface-2'), ink: cssVar('--ink'), hairline: cssVar('--hairline') }
  }, [familias, tema])

  const filas = (nivelDatos === 'upz' ? capas.upz : capas.localidad)[eleccionDatos] as Record<string, CapaFila> | undefined
  const filas19 = (nivelDatos === 'upz' ? capas.upz : capas.localidad).concejo_2019 as Record<string, CapaFila>

  const escala = useMemo(() => {
    const vals: number[] = []
    const valor = (cod: string): number | null => {
      const f = filas?.[cod]
      if (!f) return null
      if (efectiva === 'familia') return f.cuotas[familia] ?? null
      if (efectiva === 'participacion') return f.participacion
      if (efectiva === 'blanco') return f.blanco
      if (efectiva === 'cambio') {
        const a = filas19?.[cod]?.cuotas[familia]
        const b = f.cuotas[familia]
        return a == null || b == null ? null : b - a
      }
      if (efectiva === 'ganador') return f.margen ?? null
      return null
    }
    const cods = nivelDatos === 'upz' ? upzGeo.features.map((f) => f.properties.cod) : locGeo.features.map((f) => String(f.properties.localidad))
    for (const c of cods) {
      const v = valor(c)
      if (v != null && Number.isFinite(v)) vals.push(v)
    }
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const absMax = Math.max(...vals.map(Math.abs), 0.001)
    const color = (cod: string): string => {
      const f = filas?.[cod]
      if (!f) return pal.surface2
      if (efectiva === 'ganador') return f.ganador ? pal.fam[f.ganador] : pal.surface2
      if (efectiva === 'bastiones') {
        const c = capas.lisa[familia]?.[cod] ?? 'no_significativo'
        return {
          'alto-alto': pal.fam[familia],
          'alto-bajo': interpolateLab(pal.surface, pal.fam[familia])(0.45),
          'bajo-alto': pal.div[2],
          'bajo-bajo': pal.div[0],
          no_significativo: pal.surface2,
        }[c]!
      }
      const v = valor(cod)
      if (v == null) return pal.surface2
      if (efectiva === 'familia') {
        const t = max > 0 ? Math.min(Math.floor((v / max) * 6), 5) / 5 : 0
        return interpolateLab(pal.surface2, pal.fam[familia])(0.1 + 0.9 * t)
      }
      if (efectiva === 'cambio') {
        const t = Math.max(-3, Math.min(3, Math.round((v / absMax) * 3)))
        return pal.div[t + 3]
      }
      const t = max > min ? Math.min(Math.floor(((v - min) / (max - min)) * 7), 6) : 0
      return pal.seq[t + 1]
    }
    return { valor, color, min, max, absMax }
  }, [filas, filas19, efectiva, familia, nivelDatos, upzGeo, locGeo, pal, capas.lisa])

  const datosZonas = useMemo(() => {
    const base = nivelDatos === 'upz' ? upzGeo : locGeo
    return {
      type: 'FeatureCollection' as const,
      features: base.features.map((f) => {
        const p = f.properties as Record<string, unknown>
        const cod = nivelDatos === 'upz' ? String(p.cod) : String(p.localidad)
        return { ...f, properties: { ...p, cod, color: escala.color(cod) } }
      }),
    }
  }, [nivelDatos, upzGeo, locGeo, escala])

  const datosPuestos = useMemo(() => {
    const maxV = Math.max(...puestos.validos)
    return {
      type: 'FeatureCollection' as const,
      features: puestos.id.map((id, i) => {
        const cuotas = Object.fromEntries(Object.entries(puestos.cuotas).map(([k, arr]) => [k, arr[i]]))
        const gan = familias.reduce((b, f) => ((cuotas[f.id] ?? 0) > (cuotas[b] ?? 0) ? f.id : b), familias[0].id)
        const color =
          efectiva === 'familia' ? interpolateLab(pal.surface2, pal.fam[familia])(Math.min(1, (cuotas[familia] ?? 0) / 0.35)) : pal.fam[gan]
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [puestos.lon[i], puestos.lat[i]] },
          properties: { id, nombre: puestos.nombre[i], r: 2 + 7 * Math.sqrt(puestos.validos[i] / maxV), color, i },
        }
      }),
    }
  }, [puestos, familias, efectiva, familia, pal])

  // crear el mapa una vez
  useEffect(() => {
    if (!contenedor.current) return
    const m = new maplibregl.Map({
      container: contenedor.current,
      style: estiloBase(cssVar('--plane')),
      bounds: [-74.225, 4.47, -73.99, 4.84],
      fitBoundsOptions: { padding: 12 },
      attributionControl: { compact: true, customAttribution: 'Registraduría Nacional del Estado Civil · IDECA' },
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // con un estilo en línea el evento puede dispararse durante el constructor: se escucha y además se verifica
    // nombres de localidad como marcadores HTML (heredan los tokens del tema; no requieren servidor de fuentes)
    for (const f of locGeo.features) {
      if (f.properties.localidad === 20) continue
      const el = document.createElement('div')
      el.className = 'pointer-events-none select-none text-[10px] font-semibold tracking-wide text-ink-2 [text-shadow:0_0_3px_var(--surface),0_0_3px_var(--surface)]'
      el.textContent = f.properties.nombre
      new maplibregl.Marker({ element: el }).setLngLat(geoCentroid(f) as [number, number]).addTo(m)
    }
    const avisar = () => setEstiloListo((n) => n + 1)
    m.on('style.load', avisar)
    m.on('load', avisar)
    if (m.isStyleLoaded()) avisar()
    mapa.current = m
    return () => {
      m.remove()
      mapa.current = null
      eventos.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // cambio de tema: nuevo estilo base (las capas propias se vuelven a montar en style.load)
  const temaPrevio = useRef(tema)
  useEffect(() => {
    if (temaPrevio.current !== tema && mapa.current) {
      temaPrevio.current = tema
      mapa.current.setStyle(estiloBase(cssVar('--plane')))
    }
  }, [tema])

  // montar fuentes y capas propias
  useEffect(() => {
    const m = mapa.current
    if (!m || !estiloListo) return
    const antes = m.getLayer('etiquetas') ? 'etiquetas' : undefined
    if (!m.getSource('zonas')) {
      m.addSource('zonas', { type: 'geojson', data: datosZonas, promoteId: 'cod' })
      m.addLayer({ id: 'zonas-fill', type: 'fill', source: 'zonas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.82 } }, antes)
      m.addLayer({ id: 'zonas-line', type: 'line', source: 'zonas', paint: { 'line-color': pal.surface, 'line-width': 0.8 } }, antes)
      m.addLayer(
        { id: 'zonas-sel', type: 'line', source: 'zonas', paint: { 'line-color': pal.ink, 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.4, 0] } },
        antes,
      )
      m.addSource('limites', { type: 'geojson', data: locGeo })
      m.addLayer({ id: 'limites-line', type: 'line', source: 'limites', paint: { 'line-color': pal.ink, 'line-width': 1.2, 'line-opacity': 0.5 } })
      m.addSource('puestos', { type: 'geojson', data: datosPuestos })
      m.addLayer({
        id: 'puestos',
        type: 'circle',
        source: 'puestos',
        layout: { visibility: verPuestos ? 'visible' : 'none' },
        paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-stroke-color': pal.surface, 'circle-stroke-width': 1, 'circle-opacity': 0.92 },
      })
    }
    if (!eventos.current) {
      eventos.current = true
      const mover = (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        m.getCanvas().style.cursor = 'pointer'
        setTip({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, content: <span data-cod={String(f.properties?.cod)} /> })
      }
      m.on('mousemove', 'zonas-fill', mover)
      m.on('mouseleave', 'zonas-fill', () => {
        m.getCanvas().style.cursor = ''
        setTip(null)
      })
      m.on('click', 'zonas-fill', (e) => {
        const cod = e.features?.[0]?.properties?.cod
        if (cod != null) setSel(String(cod))
      })
      m.on('mousemove', 'puestos', (e) => {
        const f = e.features?.[0]
        if (!f) return
        setTip({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, content: <span data-puesto={String(f.properties?.i)} /> })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estiloListo])

  useEffect(() => {
    const m = mapa.current
    if (!m || !estiloListo) return
    ;(m.getSource('zonas') as GeoJSONSource | undefined)?.setData(datosZonas)
    if (m.getLayer('zonas-line')) m.setPaintProperty('zonas-line', 'line-color', pal.surface)
    if (m.getLayer('limites-line')) m.setPaintProperty('limites-line', 'line-color', pal.ink)
    if (m.getLayer('fondo')) m.setPaintProperty('fondo', 'background-color', cssVar('--plane'))
  }, [datosZonas, estiloListo, pal])

  useEffect(() => {
    const m = mapa.current
    if (!m || !estiloListo || !m.getSource('puestos')) return
    ;(m.getSource('puestos') as GeoJSONSource).setData(datosPuestos)
    m.setLayoutProperty('puestos', 'visibility', verPuestos ? 'visible' : 'none')
    m.setPaintProperty('puestos', 'circle-stroke-color', pal.surface)
  }, [datosPuestos, verPuestos, estiloListo, pal])

  const selPrevia = useRef<string | null>(null)
  useEffect(() => {
    const m = mapa.current
    if (!m || !estiloListo || !m.getSource('zonas')) return
    if (selPrevia.current) m.setFeatureState({ source: 'zonas', id: selPrevia.current }, { sel: false })
    if (sel) m.setFeatureState({ source: 'zonas', id: sel }, { sel: true })
    selPrevia.current = sel
  }, [sel, estiloListo, datosZonas])

  useEffect(() => {
    setSel(null)
  }, [nivelDatos])

  const nombreZona = (cod: string) =>
    nivelDatos === 'upz'
      ? upzGeo.features.find((f) => f.properties.cod === cod)?.properties.nombre ?? cod
      : meta.localidades[cod] ?? cod
  const localidadDe = (cod: string) => (nivelDatos === 'upz' ? meta.localidades[String(upzGeo.features.find((f) => f.properties.cod === cod)?.properties.localidad)] : null)

  // contenido del tooltip resuelto aquí para que siempre refleje la variable activa
  const tipResuelto: TipState | null = useMemo(() => {
    if (!tip) return null
    const el = tip.content as { props?: Record<string, string> }
    const cod = el.props?.['data-cod']
    const pi = el.props?.['data-puesto']
    if (pi !== undefined) {
      const i = Number(pi)
      const top = familias.map((f) => ({ f, v: puestos.cuotas[f.id][i] })).sort((a, b) => b.v - a.v).slice(0, 3)
      return {
        ...tip,
        content: (
          <div>
            <p className="font-semibold">{puestos.nombre[i]}</p>
            <p className="mb-1.5 text-[12px] text-muted">
              Puesto · {meta.localidades[String(puestos.localidad[i])]} · {num(puestos.validos[i])} válidos
            </p>
            {top.map(({ f, v }) => (
              <TipRow key={f.id} color={famColor(f.id)} label={f.nombre_corto} value={pct(v)} />
            ))}
          </div>
        ),
      }
    }
    if (!cod) return null
    const f = filas?.[cod]
    const top = f ? familias.map((x) => ({ x, v: f.cuotas[x.id] ?? 0 })).sort((a, b) => b.v - a.v).slice(0, 3) : []
    const v = escala.valor(cod)
    return {
      ...tip,
      content: (
        <div>
          <p className="font-semibold">{nombreZona(cod)}</p>
          {localidadDe(cod) && <p className="text-[12px] text-muted">{localidadDe(cod)}</p>}
          <div className="mt-1.5">
            {efectiva === 'participacion' && <TipRow label="Participación" value={v == null ? '–' : pct(v)} strong />}
            {efectiva === 'blanco' && <TipRow label="Voto en blanco" value={v == null ? '–' : pct(v)} strong />}
            {efectiva === 'cambio' && <TipRow color={famColor(familia)} label={`${famPorId[familia]?.nombre_corto} 2019→2023`} value={v == null ? '–' : pp(v)} strong />}
            {efectiva === 'bastiones' && <TipRow label={famPorId[familia]?.nombre_corto} value={LISA_LABEL[capas.lisa[familia]?.[cod] ?? 'no_significativo']} />}
            {top.map(({ x, v: vv }) => (
              <TipRow key={x.id} color={famColor(x.id)} label={x.nombre_corto} value={pct(vv)} />
            ))}
          </div>
        </div>
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip, filas, efectiva, familia, escala])

  const filaSel = sel ? filas?.[sel] : null
  const filaSel19 = sel ? filas19?.[sel] : null
  const necesitaFamilia = efectiva === 'familia' || efectiva === 'cambio' || efectiva === 'bastiones'

  return (
    <div>
      <SectionHeader
        eyebrow="Geografía electoral"
        title="El mapa político de Bogotá"
        lede="Resultados por UPZ y localidad a partir de la geolocalización de cada puesto de votación. Compara el Concejo con la Cámara y la Presidencia, la proyección territorial de 2027 y los bastiones estadísticos de cada fuerza."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={eleccion} onChange={(e) => setEleccion(e.target.value)} aria-label="Elección" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
          {ELECCIONES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={variable} onChange={(e) => setVariable(e.target.value as Variable)} aria-label="Variable" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
          {VARIABLES.map((o) => (
            <option key={o.value} value={o.value} disabled={(o.value === 'participacion' && !esConcejo) || (o.value === 'bastiones' && nivel === 'localidad')}>
              {o.label}
            </option>
          ))}
        </select>
        {necesitaFamilia && (
          <select value={familia} onChange={(e) => setFamilia(e.target.value)} aria-label="Familia" className="h-9 rounded-full border border-hairline bg-surface px-3 text-[13px]">
            {familias.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre_corto}
              </option>
            ))}
          </select>
        )}
        <Segmented<Nivel> label="Nivel" value={nivelDatos} onChange={setNivel} options={[{ value: 'upz', label: 'UPZ' }, { value: 'localidad', label: 'Localidad' }]} />
        <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={verPuestos} onChange={(e) => setVerPuestos(e.target.checked)} className="size-4 accent-[var(--ink)]" />
          Puestos 2023
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="card relative overflow-hidden p-0 lg:col-span-8">
          <div ref={contenedor} className="h-[68vh] min-h-[420px] w-full lg:h-[680px]" role="region" aria-label="Mapa de Bogotá por UPZ" />
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-xl border border-[var(--ring)] bg-surface/95 px-3 py-2.5 shadow-[var(--shadow)] backdrop-blur">
            <Leyenda efectiva={efectiva} familia={familia} escala={escala} pal={pal} famPorId={famPorId} familias={familias} />
          </div>
        </div>

        <Card className="lg:col-span-4">
          {filaSel ? (
            <>
              <CardTitle
                title={nombreZona(sel!)}
                subtitle={[localidadDe(sel!), ELECCIONES.find((e) => e.value === eleccionDatos)?.label].filter(Boolean).join(' · ')}
                right={
                  <button className="text-[13px] text-muted link-underline" onClick={() => setSel(null)}>
                    Cerrar
                  </button>
                }
              />
              <div className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
                {filaSel.validos > 0 && (
                  <div>
                    <p className="text-muted">Votos válidos</p>
                    <p className="tabular font-semibold">{num(filaSel.validos)}</p>
                  </div>
                )}
                {filaSel.participacion != null && (
                  <div>
                    <p className="text-muted">Participación</p>
                    <p className="tabular font-semibold">{pct(filaSel.participacion)}</p>
                  </div>
                )}
              </div>
              <ul className="space-y-1.5">
                {familias
                  .map((f) => ({ f, v: filaSel.cuotas[f.id] ?? 0, a: filaSel19?.cuotas[f.id] ?? null }))
                  .sort((x, y) => y.v - x.v)
                  .map(({ f, v, a }) => (
                    <li key={f.id} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                        <Dot familia={f.id} size={8} />
                        <span className="truncate">{f.nombre_corto}</span>
                      </span>
                      <span className="h-2 rounded-r-[3px] bg-surface-2">
                        <span className="block h-full rounded-r-[3px]" style={{ width: `${Math.min(100, (v / 0.4) * 100)}%`, background: famColor(f.id) }} />
                      </span>
                      <span className="tabular text-right">{pct(v)}</span>
                      {eleccionDatos === 'concejo_2023' && a != null && (
                        <span className={`tabular col-start-3 -mt-1 text-right text-[11px] ${v - a > 0 ? 'text-good' : v - a < 0 ? 'text-critical' : 'text-muted'}`}>{pp(v - a)}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <>
              <CardTitle title="Explora una zona" subtitle="Toca o haz clic en una UPZ o localidad para ver el detalle de su votación." />
              <Callout title="Cómo se construye">
                Cada uno de los {puestos.id.length.toLocaleString('es-CO')} puestos de 2023 se ubicó comparando su nombre con el catálogo georreferenciado de la
                Registraduría (similitud difusa dentro de la misma localidad) y se asignó a su UPZ. Los bastiones usan autocorrelación espacial local (LISA,
                999 permutaciones, p &lt; 0,05).
              </Callout>
              <p className="mt-5 eyebrow">Concentración geográfica · I de Moran 2023</p>
              <ul className="mt-2 space-y-1.5">
                {familias
                  .filter((f) => capas.moran[f.id])
                  .sort((a, b) => capas.moran[b.id].I - capas.moran[a.id].I)
                  .map((f) => (
                    <li key={f.id} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                        <Dot familia={f.id} size={8} />
                        <span className="truncate">{f.nombre_corto}</span>
                      </span>
                      <span className="h-1.5 rounded-full bg-surface-2">
                        <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(0, capas.moran[f.id].I) * 100}%` }} />
                      </span>
                      <span className="tabular text-right">{capas.moran[f.id].I.toFixed(2).replace('.', ',')}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">0 = votación dispersa al azar; 1 = zonas vecinas votan casi igual.</p>
            </>
          )}
        </Card>
      </div>
      <FloatingTip tip={tipResuelto} />
    </div>
  )
}

function Leyenda({
  efectiva,
  familia,
  escala,
  pal,
  famPorId,
  familias,
}: {
  efectiva: Variable
  familia: string
  escala: { min: number; max: number; absMax: number }
  pal: { fam: Record<string, string>; seq: string[]; div: string[]; surface: string; surface2: string }
  famPorId: Record<string, { nombre_corto: string }>
  familias: { id: string; nombre_corto: string }[]
}) {
  if (efectiva === 'ganador')
    return (
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Familia más votada</p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
          {familias.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="size-2.5 rounded-sm" style={{ background: pal.fam[f.id] }} />
              {f.nombre_corto}
            </li>
          ))}
        </ul>
      </div>
    )
  if (efectiva === 'bastiones')
    return (
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Bastiones de {famPorId[familia]?.nombre_corto}</p>
        <ul className="space-y-0.5">
          {LISA.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span
                className="size-2.5 rounded-sm"
                style={{
                  background: { 'alto-alto': pal.fam[familia], 'alto-bajo': interpolateLab(pal.surface, pal.fam[familia])(0.45), 'bajo-alto': pal.div[2], 'bajo-bajo': pal.div[0], no_significativo: pal.surface2 }[c],
                }}
              />
              {LISA_LABEL[c]}
            </li>
          ))}
        </ul>
      </div>
    )
  if (efectiva === 'cambio')
    return (
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Cambio de {famPorId[familia]?.nombre_corto}, 2019→2023</p>
        <div className="flex h-2.5 w-52 overflow-hidden rounded-sm">
          {pal.div.map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="tabular mt-1 flex w-52 justify-between text-[10px] text-muted">
          <span>{pp(-escala.absMax, 0)}</span>
          <span>0</span>
          <span>{pp(escala.absMax, 0)}</span>
        </div>
      </div>
    )
  const titulo = efectiva === 'familia' ? `Votos de ${famPorId[familia]?.nombre_corto}` : efectiva === 'participacion' ? 'Participación' : 'Voto en blanco'
  const colores = efectiva === 'familia' ? [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => interpolateLab(pal.surface2, pal.fam[familia])(0.1 + 0.9 * t)) : pal.seq.slice(1)
  const min = efectiva === 'familia' ? 0 : escala.min
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-ink-2">{titulo}</p>
      <div className="flex h-2.5 w-52 overflow-hidden rounded-sm">
        {colores.map((c, i) => (
          <span key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="tabular mt-1 flex w-52 justify-between text-[10px] text-muted">
        <span>{pct(min, 0)}</span>
        <span>{pct(escala.max, 0)}</span>
      </div>
    </div>
  )
}
