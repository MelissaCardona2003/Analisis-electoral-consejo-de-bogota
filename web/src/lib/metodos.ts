/**
 * Nombres y explicaciones en lenguaje sencillo de los seis métodos que compiten en el backtest
 * (claves = pipeline/model.py:NOMBRES_REGLA). Las etiquetas técnicas del pipeline se conservan en los
 * datos; aquí está lo que ve el lector.
 */
export const METODOS: Record<string, { nombre: string; idea: string }> = {
  persistencia: {
    nombre: 'Repetir el Concejo 2023',
    idea: 'Cada familia saca lo mismo que en el Concejo anterior. Es el punto de comparación más simple.',
  },
  swing_uniforme: {
    nombre: 'Sumar el cambio de la Cámara',
    idea: 'Parte del Concejo anterior y le suma a cada familia los puntos que subió o bajó en la Cámara entre sus dos últimas elecciones.',
  },
  transferencia: {
    nombre: 'Trasladar parte del cambio de la Cámara',
    idea: 'Como el anterior, pero solo traslada la fracción del cambio que, en el pasado, terminó reflejándose en el Concejo (en términos relativos, no en puntos).',
  },
  transferencia_matriz: {
    nombre: 'Seguir el rastro del voto (Cámara)',
    idea: 'Estima, con los resultados de cada puesto de votación, a dónde se movió el voto de cada familia entre dos elecciones de Cámara y proyecta ese patrón hacia adelante (sección 5).',
  },
  transferencia_presidencial: {
    nombre: 'Trasladar parte del cambio presidencial',
    idea: 'Como «trasladar parte del cambio de la Cámara», pero mirando cómo cambió la votación entre las dos últimas elecciones presidenciales.',
  },
  transferencia_matriz_presidencial: {
    nombre: 'Traducir la última presidencial al Concejo',
    idea: 'Aprende, en el ciclo anterior, cómo se convirtió el voto presidencial en voto al Concejo y aplica ese puente a la presidencial más reciente (sección 5).',
  },
}

export const nombreMetodo = (clave: string) => METODOS[clave]?.nombre ?? clave
