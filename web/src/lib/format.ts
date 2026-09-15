const entero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const compacto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 })

export const num = (v: number) => entero.format(Math.round(v))

export const compact = (v: number) => compacto.format(v)

/** 0.1234 -> "12,3 %" (norma RAE: espacio antes del signo) */
export const pct = (v: number, d = 1) =>
  `${(v * 100).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })} %`

/** diferencia en puntos porcentuales con signo tipográfico: +1,2 pp / −0,8 pp */
export const pp = (v: number, d = 1) => {
  const s = Math.abs(v * 100).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
  return `${v > 0.00005 ? '+' : v < -0.00005 ? '−' : '±'}${s} pp`
}

export const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v))}`

export const dec = (v: number, d = 2) =>
  v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
