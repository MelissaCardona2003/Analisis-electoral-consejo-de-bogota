import { use } from 'react'
import { cargar } from './data'
import type { Meta } from './types'

/** Lee un JSON exportado; debe usarse dentro de un <Suspense>. */
export function useJson<T>(nombre: string): T {
  return use(cargar<T>(nombre))
}

export function useMeta() {
  const meta = useJson<Meta>('meta.json')
  const familias = [...meta.familias].sort((a, b) => a.orden - b.orden)
  const famPorId = Object.fromEntries(familias.map((f) => [f.id, f]))
  return { meta, familias, famPorId }
}
