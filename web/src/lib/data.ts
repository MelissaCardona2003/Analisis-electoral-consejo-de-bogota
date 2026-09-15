/** Carga perezosa de los JSON exportados por el pipeline, con caché de promesas para `use()`. */
const cache = new Map<string, Promise<unknown>>()

export function cargar<T>(nombre: string): Promise<T> {
  let p = cache.get(nombre)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${nombre}`).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${nombre} (${r.status})`)
      return r.json()
    })
    cache.set(nombre, p)
  }
  return p as Promise<T>
}
