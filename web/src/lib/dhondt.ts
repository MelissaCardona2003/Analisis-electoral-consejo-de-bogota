/**
 * Motor electoral del Concejo de Bogotá, idéntico al de `pipeline/seats.py`:
 * votos válidos = listas + blanco; cociente = válidos / curules; umbral = 50 % del cociente;
 * reparto por cifra repartidora (D'Hondt) entre las listas que superan el umbral.
 */
export interface ListaVotos {
  id: string
  votos: number
}

export interface Reparto {
  curules: Record<string, number>
  validos: number
  cociente: number
  umbral: number
  cifra: number
  ultimaCurul: string | null
  siguienteEnFila: string | null
  votosParaOtraCurul: Record<string, number>
}

export const CURULES_REPARTIDORA = 44
export const UMBRAL_FRACCION = 0.5

export function cifraRepartidora(
  listas: ListaVotos[],
  blancos: number,
  curules = CURULES_REPARTIDORA,
  umbralFraccion = UMBRAL_FRACCION,
): Reparto {
  const validos = listas.reduce((s, l) => s + l.votos, 0) + blancos
  const cociente = validos / curules
  const umbral = umbralFraccion * cociente

  const cocientes: { q: number; v: number; id: string }[] = []
  for (const l of listas) {
    if (l.votos <= 0 || l.votos < umbral) continue
    for (let d = 1; d <= curules; d++) cocientes.push({ q: l.votos / d, v: l.votos, id: l.id })
  }
  cocientes.sort((a, b) => b.q - a.q || b.v - a.v)

  const asignadas: Record<string, number> = Object.fromEntries(listas.map((l) => [l.id, 0]))
  const ganadores = cocientes.slice(0, curules)
  for (const c of ganadores) asignadas[c.id] += 1
  const cifra = ganadores.length ? ganadores[ganadores.length - 1].q : 0

  const votosParaOtraCurul: Record<string, number> = {}
  for (const l of listas) {
    const necesario = Math.max(Math.floor(cifra * (asignadas[l.id] + 1)) + 1, Math.ceil(umbral))
    votosParaOtraCurul[l.id] = Math.max(necesario - l.votos, 0)
  }

  return {
    curules: asignadas,
    validos,
    cociente,
    umbral,
    cifra,
    ultimaCurul: ganadores.length ? ganadores[ganadores.length - 1].id : null,
    siguienteEnFila: cocientes[curules]?.id ?? null,
    votosParaOtraCurul,
  }
}
