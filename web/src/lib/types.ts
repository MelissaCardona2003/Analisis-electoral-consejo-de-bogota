/** Formas de los JSON exportados por `pipeline/export.py`. */

export interface Familia {
  id: string
  nombre: string
  nombre_corto: string
  orden: number
  color_claro: string
  color_oscuro: string
  descripcion: string
}

export interface Meta {
  familias: Familia[]
  localidades: Record<string, string>
  generado: string
  eleccion: string
  listas: Record<string, { nombre: string; familia: string }>
}

export interface Ciudad {
  potencial: number
  votantes: number
  participacion: number
  validos: number
  votos_listas: number
  blanco: number
  nulo: number
  no_marcado: number
  pct_blanco: number
  pct_nulo: number
  pct_no_marcado: number
  nep_votos: number
  nep_curules: number
  gallagher: number
  listas_inscritas: number
  listas_con_curul: number
  listas_sobre_umbral: number
  familias_pct_validos: Record<string, number>
  voto_preferente_pct: number
}

export interface ListaResultado {
  id: string
  nombre: string
  familia: string
  votos: number
  votos_lista: number
  votos_candidato: number
  pct: number
  curules: number
  oposicion: number
  supera_umbral: boolean
  faltan_para_otra: number
  colchon: number
  sin_lista?: boolean
}

export interface ResultadoAnio {
  ciudad: Ciudad
  listas: ListaResultado[]
  cociente: number
  umbral: number
  cifra_repartidora: number
  cocientes: { id: string; q: number[] }[]
}

export interface Resultados {
  '2019': ResultadoAnio
  '2023': ResultadoAnio
  historico_familias: Record<string, Record<string, { cuota: number; curules: number }>>
  pedersen_familias: number
  pedersen_listas: number
}

export interface Distribucion {
  media: number
  p50: number
  p10: number
  p90: number
  p025: number
  p975: number
}

export interface DistCurules extends Distribucion {
  p_cero: number
  hist: number[]
}

export interface FamiliaPronostico {
  id: string
  cuota: Distribucion
  curules: DistCurules
  p_mayor_bancada: number
  cuota_2023: number
  curules_2023: number
  cuota_camara_2026: number
}

export interface ListaPronostico {
  id: string
  nombre: string
  familia: string
  cuota: Distribucion
  curules: DistCurules
  p_umbral: number
  curules_2023: number
}

export interface Kappa {
  kappa_mco: number
  rmse_cv_logit_con_kappa: number
  rmse_cv_logit_persistencia: number
  correlacion: number
  familias: { categoria: string; cambio_camara: number; cambio_concejo: number; kappa_sin_ella: number }[]
}

export interface Volatilidad {
  sigma: number
  sigma_robusta: number
  nu: number
  escala_t: number
  n: number
  cambios?: { de: number; a: number; categoria: string; cuota_de: number; cuota_a: number; cambio_logit: number }[]
  emergencias: { de: number; a: number; categoria: string; cuota: number }[]
}

export interface Pronostico {
  generado: string
  eleccion: string
  n_simulaciones: number
  beta_local: number
  cuotas_historicas: Record<string, Record<string, number>>
  participacion: {
    potencial_2019: number
    potencial_2023: number
    potencial_2026: number
    crecimiento_anual: number
    potencial_2027: number
    participacion: Distribucion
    votantes: Distribucion
    validos: Distribucion
    cociente_votos: Distribucion
    umbral_votos: Distribucion
  }
  pronostico: {
    regla_central: string
    nombre_regla: string
    volatilidad: Volatilidad
    kappa: Kappa
    conversion_camara_concejo: { mediana: number; mu_log: number; sd_log: number; por_familia: Record<string, number> }
    emergente: { id: string; cuota_base: number; mu_log: number; sd_log: number }
    centro_cuotas: Record<string, number>
    familias: FamiliaPronostico[]
    listas: ListaPronostico[]
    escenarios: Record<string, Record<string, Distribucion>>
    blanco: Distribucion
  }
  backtest: {
    volatilidad_previa: Volatilidad
    kappa: Kappa
    elegido: string
    metricas: Record<
      string,
      {
        nombre: string
        mae_pp: number
        rmse_pp: number
        error_curules_familias: number
        cuotas: Record<string, number>
        curules_familias: Record<string, number>
      }
    >
    cobertura_cuotas_80: number
    cobertura_cuotas_95: number
    cobertura_curules_80: number
    cobertura_curules_95: number
    familias: {
      familia: string
      real_cuota: number
      real_curules: number
      cuota: Distribucion
      curules: DistCurules
      cuota_dentro_80: boolean
      dentro_80: boolean
      dentro_95: boolean
    }[]
  }
}

export interface CapaFila {
  cuotas: Record<string, number | null>
  blanco: number | null
  participacion: number | null
  validos: number
  ganador: string | null
  margen: number | null
}

export interface Capas {
  upz: Record<string, Record<string, CapaFila | { cuotas: Record<string, number>; blanco: number; ganador: string }>>
  localidad: Record<string, Record<string, CapaFila>>
  lisa: Record<string, Record<string, string>>
  moran: Record<string, { I: number; p?: number }>
}

export interface Puestos {
  id: string[]
  nombre: string[]
  lon: number[]
  lat: number[]
  localidad: number[]
  upz: string[]
  validos: number[]
  participacion: (number | null)[]
  cuotas: Record<string, number[]>
}

export interface Territorio {
  localidades: Record<string, { nombre: string; volatilidad: number | null; series: Record<string, CapaFila> }>
  demografia: {
    n_puestos: number
    variables: string[]
    modelos: Record<string, { r2: number; intercepto: number; coef: Record<string, { b: number; ee: number }> }>
    puntos: ({ id: string; j: number; m60: number; part: number } & Record<string, number | string>)[]
  }
  moran: Record<string, { I: number; p?: number }>
}

export interface Candidato {
  anio: number
  nombre: string
  lista_id: string
  lista_nombre: string
  familia_id: string
  votos: number
  pct_de_lista: number
  rank_lista: number
  elegido: boolean
  localidad_fuerte: number | null
  pct_localidad_fuerte: number
  gini_puestos: number
  compitio_ambos: boolean
  similitud_territorial: number | null
  vector_localidades: number[]
  clave: string
}

export interface Simulador {
  listas: { id: string; nombre: string; familia: string; cuota: number; cuota_2023: number }[]
  blanco: number
  blanco_2023: number
  validos_2027: number
  participacion_2027: number
  potencial_2027: number
}

export interface Simulaciones {
  listas: string[]
  curules: number[][]
}
