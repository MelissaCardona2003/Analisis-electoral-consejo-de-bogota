# Observatorio del Concejo de Bogotá · 2019–2027

Análisis de las elecciones al Concejo de Bogotá de 2019 y 2023 y pronóstico probabilístico de su composición en
las elecciones del 31 de octubre de 2027, presentado en una aplicación web interactiva.

## Qué contiene

| Sección | Contenido |
|---|---|
| Resumen | Hemiciclo 2019 / 2023 / 2027, indicadores clave y hallazgos |
| Resultados | Votos y curules por lista, explicador interactivo de la cifra repartidora, evolución 2011–2023 |
| Mapa | UPZ, localidades y puestos (MapLibre): fuerza por familia, participación, blanco, cambio y bastiones LISA |
| Territorio | Matriz localidad × familia y relación ecológica edad–voto |
| Candidatos | Buscador, concentración territorial y trayectorias 2019→2023 |
| Pronóstico 2027 | Distribución de curules, coaliciones, escenarios y backtest sobre 2023 |
| Simulador | Reparto en vivo con el mismo motor de la Registraduría |
| Metodología | Limpieza, validaciones, equivalencias de partidos y modelo |

## Estructura

```
data/raw/          archivos originales (MMV Concejo 2019/2023, censo por puesto, geojson de puestos y UPZ)
data/external/     descargas de la Registraduría y datos.gov.co (no versionadas)
data/interim/      parquet limpios
data/processed/    agregados, análisis y modelo
reference/         familias políticas, overrides de partidos, histórico 2011/2015, crosswalk generado
reports/           reportes de calidad (JSON)
pipeline/          código Python (ingest, external, aggregate, analysis, model, export) y tests
web/               app Vite + React + TypeScript (Tailwind, MapLibre, D3)
```

## Reproducir

```bash
python -m venv --system-site-packages .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pipeline.ingest
.venv/Scripts/python -m pipeline.external
.venv/Scripts/python -m pipeline.aggregate
.venv/Scripts/python -m pipeline.analysis
.venv/Scripts/python -m pipeline.model
.venv/Scripts/python -m pipeline.export
.venv/Scripts/python -m pytest
cd web && npm install && npx vitest run && npm run build
```

Las descargas externas (≈ 620 MB) se obtienen de
<https://observatorio.registraduria.gov.co/views/electoral/historicos-resultados.php> (Congreso 2022 Bogotá,
Congreso 2026, Presidencia 1.ª vuelta 2018/2022/2026) y de Datos Abiertos Colombia (Cámara 2018, conjunto
`vkjr-c6fe`), y se guardan en `data/external/`.

## Validaciones

- La cifra repartidora reproduce la composición oficial del Concejo en 2011, 2015, 2019 y 2023.
- El motor en TypeScript da el mismo reparto que el de Python.
- Censo: sexo y rangos de edad suman el potencial en todos los puestos.

## Despliegue

`vercel.json` construye `web/` y publica `web/dist` como sitio estático.
