import type { MatrizTransferencia } from './types'

/**
 * Una fila de la matriz es «sin datos» cuando el método no se movió de su valor de partida (un reparto
 * parejo entre todos los destinos, 10 % cada uno con 10 categorías). Ocurre cuando esa familia tuvo muy
 * poca o ninguna votación propia en la elección de origen —p. ej. un partido que no llevó candidato a
 * las presidenciales—: no hay puestos donde observar hacia dónde se movió su voto, y mostrar ese reparto
 * parejo como si fuera un resultado sería engañoso.
 */
export function filaSinDatos(m: MatrizTransferencia, i: number, tolerancia = 0.02): boolean {
  const uniforme = 1 / m.categorias.length
  return m.media[i].every((p) => Math.abs(p - uniforme) < tolerancia)
}

export interface Segmento {
  categoria: string
  p: number
}

/** Los destinos de una fila: cuánto «se queda» en la misma categoría y el resto de destinos, de mayor a menor. */
export function destinosDeFila(m: MatrizTransferencia, i: number): { queda: number; rangoQueda: [number, number]; otros: Segmento[] } {
  const otros = m.categorias
    .map((categoria, j) => ({ categoria, p: m.media[i][j] }))
    .filter((_, j) => j !== i)
    .sort((a, b) => b.p - a.p)
  return { queda: m.media[i][i], rangoQueda: [m.p05[i][i], m.p95[i][i]], otros }
}

/** Segmentos de la barra apilada: primero lo que se queda, luego los demás destinos en el orden fijo de las categorías. */
export function segmentosDeBarra(m: MatrizTransferencia, i: number): Segmento[] {
  const propio = { categoria: m.categorias[i], p: m.media[i][i] }
  const resto = m.categorias.map((categoria, j) => ({ categoria, p: m.media[i][j] })).filter((_, j) => j !== i)
  return [propio, ...resto]
}

/** El mayor flujo entre familias distintas, ignorando las filas sin datos. */
export function mayorFlujoFuera(m: MatrizTransferencia): { origen: string; destino: string; p: number } | null {
  let mejor: { origen: string; destino: string; p: number } | null = null
  m.categorias.forEach((origen, i) => {
    if (filaSinDatos(m, i)) return
    m.categorias.forEach((destino, j) => {
      if (i === j) return
      if (!mejor || m.media[i][j] > mejor.p) mejor = { origen, destino, p: m.media[i][j] }
    })
  })
  return mejor
}

/** «a Centro Democrático», «a otros partidos», «al voto en blanco»: el destino con su preposición, para frases naturales. */
export function haciaTexto(categoria: string, nombre: string): string {
  if (categoria === 'blanco') return 'al voto en blanco'
  if (categoria === 'otros') return 'a otros partidos'
  return `a ${nombre}`
}

/** Nombre legible de cada par de elecciones estimado (ver pipeline/transferencia.py:PARES). */
export const ETIQUETA_PAR: Record<string, string> = {
  camara_2022_2026: 'Cámara 2022 → 2026',
  camara_2018_2022: 'Cámara 2018 → 2022',
  presidente_2022_concejo_2023: 'Presidencial 2022 → Concejo 2023',
  presidente_2018_concejo_2019: 'Presidencial 2018 → Concejo 2019',
  concejo_2019_2023: 'Concejo 2019 → 2023',
}
