"""Rutas y constantes compartidas por todo el pipeline."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
EXTERNAL = ROOT / "data" / "external"
INTERIM = ROOT / "data" / "interim"
PROCESSED = ROOT / "data" / "processed"
REFERENCE = ROOT / "reference"
REPORTS = ROOT / "reports"
WEB_DATA = ROOT / "web" / "public" / "data"

for _d in (EXTERNAL, INTERIM, PROCESSED, REPORTS, WEB_DATA):
    _d.mkdir(parents=True, exist_ok=True)

YEARS = (2019, 2023)
MMV_ZIP = {
    2019: RAW / "MMV_TERRITORIALES2019_BOGOTA.zip",
    2023: RAW / "MMV_TERRITORIALES2023_BOGOTA.zip",
}
CENSO_CSV = {2019: RAW / "censo_2019.csv", 2023: RAW / "censo_2023.csv"}
PUESTOS_GEOJSON = RAW / "puestos_bogota.geojson"
UPZ_GEOJSON = RAW / "upz_bogota.geojson"

# Concejo de Bogotá: 45 curules = 44 por cifra repartidora + 1 del Estatuto de la Oposición
# (Ley 1909 de 2018, art. 25: segundo candidato a la Alcaldía).
CURULES_TOTALES = 45
CURULES_REPARTIDORA = 44
UMBRAL_FRACCION_COCIENTE = 0.5  # Art. 263 C.P.: 50% del cociente en circunscripciones de más de 2 curules
ELECCION_2027 = "2027-10-31"

# Composición oficial (escrutinio) por lista, para validar el motor de curules.
# Fuente: Registraduría / Wikipedia (Elecciones locales de Bogotá 2019; Composición del Concejo 2024-2027).
CURULES_OFICIALES = {
    2019: {
        "repartidora": {"av": 12, "liberal": 7, "cd": 5, "cr": 4, "polo": 4, "colombia_humana": 4,
                         "bogota_para_la_gente": 2, "conservador": 2, "cjl": 2, "mira": 1, "la_u": 1},
        "oposicion": "bogota_para_la_gente",  # Carlos Fernando Galán
    },
    2023: {
        "repartidora": {"av": 8, "nuevo_liberalismo": 8, "pacto_historico": 7, "cd": 7, "liberal": 6,
                         "cr_mira_u": 4, "lara": 2, "conservador_cjl": 1, "bogota_mas_fuerte": 1},
        "oposicion": "con_toda_por_bogota",  # Juan Daniel Oviedo
    },
}

SEED = 20271031
N_SIMULACIONES = 10_000
