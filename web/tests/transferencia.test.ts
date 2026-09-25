import { describe, expect, it } from 'vitest'
import { destinosDeFila, filaSinDatos, haciaTexto, mayorFlujoFuera, segmentosDeBarra } from '../src/lib/transferencia'
import type { MatrizTransferencia } from '../src/lib/types'

const cats = ['a', 'b', 'c', 'blanco']
const K = cats.length

const parejo = Array(K).fill(1 / K) // valor de partida: ninguna información

const m: MatrizTransferencia = {
  categorias: cats,
  media: [
    [0.7, 0.2, 0.05, 0.05], // a: se queda 70 %, 20 % a b
    parejo, // b: sin datos
    [0.1, 0.1, 0.6, 0.2], // c
    [0.05, 0.05, 0.1, 0.8], // blanco
  ],
  p05: [
    [0.6, 0.1, 0, 0],
    parejo,
    [0, 0, 0.5, 0.1],
    [0, 0, 0, 0.7],
  ],
  p95: [
    [0.8, 0.3, 0.1, 0.1],
    parejo,
    [0.2, 0.2, 0.7, 0.3],
    [0.1, 0.1, 0.2, 0.9],
  ],
  kappa_media: 100,
  ess_min: 500,
  rhat_max: 1.005,
  n_puestos: 800,
}

describe('filaSinDatos', () => {
  it('detecta el reparto parejo de partida como «sin datos»', () => {
    expect(filaSinDatos(m, 1)).toBe(true)
  })
  it('no marca como sin datos una fila con información', () => {
    expect(filaSinDatos(m, 0)).toBe(false)
    expect(filaSinDatos(m, 2)).toBe(false)
  })
  it('una fila casi pareja pero con una señal clara sí cuenta como dato', () => {
    const cerca = { ...m, media: [...m.media.slice(0, 1), [0.3, 0.2, 0.25, 0.25], ...m.media.slice(2)] }
    expect(filaSinDatos(cerca, 1)).toBe(false)
  })
})

describe('destinosDeFila', () => {
  it('separa lo que se queda del resto y ordena los destinos de mayor a menor', () => {
    const d = destinosDeFila(m, 0)
    expect(d.queda).toBe(0.7)
    expect(d.rangoQueda).toEqual([0.6, 0.8])
    expect(d.otros.map((o) => o.categoria)).toEqual(['b', 'c', 'blanco'])
    expect(d.otros[0].p).toBe(0.2)
  })
})

describe('segmentosDeBarra', () => {
  it('empieza por lo que se queda y suma 1', () => {
    const s = segmentosDeBarra(m, 2)
    expect(s[0]).toEqual({ categoria: 'c', p: 0.6 })
    expect(s).toHaveLength(K)
    expect(s.reduce((t, x) => t + x.p, 0)).toBeCloseTo(1, 10)
  })
})

describe('mayorFlujoFuera', () => {
  it('ignora la diagonal y las filas sin datos', () => {
    // la fila «b» (sin datos) valdría 0.25 en cada celda; el mayor flujo real es a→b = 0.2
    expect(mayorFlujoFuera(m)).toEqual({ origen: 'a', destino: 'b', p: 0.2 })
  })
  it('devuelve null si todas las filas carecen de datos', () => {
    const vacia: MatrizTransferencia = { ...m, media: [parejo, parejo, parejo, parejo] }
    expect(mayorFlujoFuera(vacia)).toBeNull()
  })
})

describe('haciaTexto', () => {
  it('pone la preposición correcta según el destino', () => {
    expect(haciaTexto('centro_democratico', 'Centro Democrático')).toBe('a Centro Democrático')
    expect(haciaTexto('blanco', 'Voto en blanco')).toBe('al voto en blanco')
    expect(haciaTexto('otros', 'Otras')).toBe('a otros partidos')
  })
})
