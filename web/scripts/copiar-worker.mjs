// Copia el web worker de MapLibre (y el chunk que importa) a public/maplibre para servirlo con una URL estable.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const origen = join(raiz, 'node_modules', 'maplibre-gl', 'dist')
const destino = join(raiz, 'public', 'maplibre')
mkdirSync(destino, { recursive: true })
for (const archivo of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(origen, archivo), join(destino, archivo))
}
console.log('MapLibre worker → public/maplibre')
