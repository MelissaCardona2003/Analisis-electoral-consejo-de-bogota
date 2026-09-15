import { describe, expect, it } from 'vitest'
import casos from '../src/lib/__fixtures__/dhondt_casos.json'
import { cifraRepartidora } from '../src/lib/dhondt'

describe('cifraRepartidora (TypeScript) = pipeline/seats.py', () => {
  for (const caso of casos) {
    it(`reproduce la composición oficial del Concejo ${caso.anio}`, () => {
      const r = cifraRepartidora(caso.listas, caso.blancos)
      for (const [id, curules] of Object.entries(caso.esperado)) {
        expect(r.curules[id]).toBe(curules)
      }
      expect(Object.values(r.curules).reduce((s, v) => s + v, 0)).toBe(44)
    })
  }

  it('excluye listas bajo el umbral', () => {
    const r = cifraRepartidora([{ id: 'A', votos: 500 }, { id: 'B', votos: 400 }, { id: 'C', votos: 40 }], 60, 10)
    expect(r.umbral).toBeCloseTo(50)
    expect(r.curules.C).toBe(0)
  })
})
