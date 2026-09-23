"""Fase 2 — Equivalencias de partidos entre elecciones.

Cada lista se asigna a una *familia política* con continuidad 2018–2026 mediante reglas explícitas sobre el
nombre normalizado (el resultado queda auditable en ``reference/partidos_crosswalk.csv``). Una coalición de
partidos de familias distintas se reparte entre ellas en proporción a la votación propia de cada partido socio
en el Concejo (máximo entre 2019 y 2023). Los casos que las reglas no resuelven se fijan en
``reference/partidos_overrides.csv``.
"""
from __future__ import annotations

import re
from statistics import median

import pandas as pd

from . import config as C
from .textnorm import text_key

FAMILIAS = pd.read_csv(C.REFERENCE / "familias.csv").sort_values("orden")
FAMILIA_IDS = FAMILIAS["familia_id"].tolist()
NO_PARTIDISTAS = ["blanco", "nulo", "no_marcado"]

# (partido socio, familia, patrón sobre text_key del nombre de la lista)
REGLAS: list[tuple[str, str, str]] = [
    ("pacto_historico", "pacto_historico", r"PACTO HISTORICO"),
    ("colombia_humana", "pacto_historico", r"COLOMBIA HUMANA|DECENCIA|UNION PATRIOTICA"),
    ("polo", "pacto_historico", r"POLO DEMOCRATICO"),
    ("farc", "pacto_historico", r"\bCOMUNES\b|FUERZA ALTERNATIVA REVOLUCIONARIA|\bFARC\b"),
    ("frente_amplio", "pacto_historico", r"FRENTE AMPLIO"),
    ("av", "alianza_verde", r"ALIANZA VERDE"),
    ("nuevo_liberalismo", "nuevo_liberalismo", r"NUEVO LIBERALISMO|BOGOTA PARA LA GENTE"),
    ("liberal", "liberal", r"PARTIDO LIBERAL|PAR LIBERAL|LIBERAL COLOMBIANO"),
    ("cr", "cr_mira_u", r"CAMBIO RADICAL"),
    ("mira", "cr_mira_u", r"\bMIRA\b"),
    ("la_u", "cr_mira_u", r"PARTIDO DE LA U\b|UNIDAD NACIONAL|UNION POR LA GENTE"),
    ("conservador", "conservador_cjl", r"CONSERVADOR"),
    ("cjl", "conservador_cjl", r"JUSTA LIBRE"),
    ("cd", "centro_democratico", r"CENTRO DEMOCRATICO"),
    ("bogota_mas_fuerte", "salvacion_nacional", r"SALVACION NACIONAL|BOGOTA MAS FUERTE"),
    ("dignidad_compromiso", "otros", r"DIGNIDAD"),
    ("centro_esperanza", "otros", r"CENTRO ESPERANZA|OXIGENO|ESTAMOS LISTAS"),
]
_REGLAS_RE = [(p, f, re.compile(rx)) for p, f, rx in REGLAS]

# Candidatos presidenciales -> familia (solo para el termómetro presidencial por territorio).
PRESIDENCIALES = {
    "GUSTAVO PETRO": "pacto_historico", "IVAN CEPEDA CASTRO": "pacto_historico",
    "IVAN DUQUE": "centro_democratico", "PALOMA VALENCIA LASERNA": "centro_democratico",
    "FEDERICO GUTIERREZ": "centro_democratico",
    "SERGIO FAJARDO": "otros", "SERGIO FAJARDO VALDERRAMA": "otros", "CLAUDIA LOPEZ": "alianza_verde",
    "HUMBERTO DE LA CALLE": "liberal", "GERMAN VARGAS LLERAS": "cr_mira_u",
    "ABELARDO DE LA ESPRIELLA": "salvacion_nacional", "ENRIQUE GOMEZ": "salvacion_nacional",
    "ENRIQUE GOMEZ MARTINEZ": "salvacion_nacional", "JOHN MILTON RODRIGUEZ": "conservador_cjl",
    "RODOLFO HERNANDEZ": "otros",  # independiente sin linaje en el Concejo, igual que Fajardo — no cambia
                                    # ningún número: hoy ya cae en "otros" por el default de aggregate.py
}

# Listas del Concejo: identificador estable.
CONCEJO_LISTAS = {
    (2019, "00004"): "av", (2019, "00001"): "liberal", (2019, "00011"): "cd", (2019, "00003"): "cr",
    (2019, "00009"): "polo", (2019, "01946"): "colombia_humana", (2019, "01406"): "bogota_para_la_gente",
    (2019, "00002"): "conservador", (2019, "00014"): "cjl", (2019, "00007"): "mira", (2019, "00008"): "la_u",
    (2019, "00013"): "farc", (2019, "00015"): "colombia_renaciente", (2019, "00006"): "asi", (2019, "00017"): "pre",
    (2019, "00016"): "ada",
    (2023, "00004"): "av", (2023, "07751"): "nuevo_liberalismo", (2023, "07726"): "pacto_historico",
    (2023, "00011"): "cd", (2023, "00001"): "liberal", (2023, "05410"): "cr_mira_u", (2023, "07457"): "lara",
    (2023, "07733"): "conservador_cjl", (2023, "05443"): "bogota_mas_fuerte", (2023, "00017"): "dignidad_compromiso",
    (2023, "00030"): "esperanza_democratica", (2023, "00037"): "fuerza_ciudadana", (2023, "00033"): "creemos",
    (2023, "00005"): "aico", (2023, "00023"): "liga",
}
# id -> (nombre de visualización con tildes correctas, familia)
LISTAS_INFO = {
    "av": ("Alianza Verde", "alianza_verde"), "liberal": ("Partido Liberal", "liberal"),
    "cd": ("Centro Democrático", "centro_democratico"), "cr": ("Cambio Radical", "cr_mira_u"),
    "polo": ("Polo Democrático Alternativo", "pacto_historico"),
    "colombia_humana": ("Colombia Humana–UP–MAIS", "pacto_historico"),
    "bogota_para_la_gente": ("Bogotá para la Gente", "nuevo_liberalismo"),
    "conservador": ("Partido Conservador", "conservador_cjl"), "cjl": ("Colombia Justa Libres", "conservador_cjl"),
    "mira": ("MIRA", "cr_mira_u"), "la_u": ("Partido de la U", "cr_mira_u"), "farc": ("FARC (hoy Comunes)", "pacto_historico"),
    "colombia_renaciente": ("Colombia Renaciente", "otros"), "asi": ("Alianza Social Independiente", "otros"),
    "pre": ("Reivindicación Étnica (PRE)", "otros"), "ada": ("Alianza Democrática Amplia", "otros"),
    "nuevo_liberalismo": ("Nuevo Liberalismo en Marcha", "nuevo_liberalismo"),
    "pacto_historico": ("Pacto Histórico", "pacto_historico"), "cr_mira_u": ("Cambio Radical–MIRA–La U", "cr_mira_u"),
    "lara": ("LaRA Bogotá", "otros"), "conservador_cjl": ("Conservador–Colombia Justa Libres", "conservador_cjl"),
    "bogota_mas_fuerte": ("Bogotá Más Fuerte", "salvacion_nacional"),
    "dignidad_compromiso": ("Dignidad & Compromiso", "otros"),
    "esperanza_democratica": ("Esperanza Democrática", "otros"), "fuerza_ciudadana": ("Fuerza Ciudadana", "otros"),
    "creemos": ("Creemos", "otros"), "aico": ("AICO", "otros"), "liga": ("Liga de Gobernantes Anticorrupción", "otros"),
    "con_toda_por_bogota": ("Con Toda por Bogotá", "otros"),
}


def socios_de_nombre(nombre: str) -> list[tuple[str, str]]:
    """Partidos socios (y su familia) reconocidos en el nombre de una lista."""
    k = text_key(nombre)
    socios = [(p, f) for p, f, rx in _REGLAS_RE if rx.search(k)]
    return socios or [("sin_regla", "otros")]


def construir_crosswalk(listas: pd.DataFrame, fuerza_partido: dict[str, float]) -> pd.DataFrame:
    """``listas``: eleccion, partido_cod, partido_nombre, votos. Devuelve una fila por (lista, familia) con su peso."""
    overrides_path = C.REFERENCE / "partidos_overrides.csv"
    overrides = pd.read_csv(overrides_path, dtype=str) if overrides_path.exists() else pd.DataFrame(
        columns=["eleccion", "partido_cod", "familias", "nota"])
    ov = {(r.eleccion, r.partido_cod.zfill(5)): r.familias.split("|") for r in overrides.itertuples()}
    por_defecto = median(fuerza_partido.values()) if fuerza_partido else 1.0

    filas = []
    for r in listas.itertuples():
        clave = (r.eleccion, str(r.partido_cod).zfill(5))
        if clave in ov:
            socios, fuente = [(f"override_{f}", f) for f in ov[clave]], "override"
        else:
            socios, fuente = socios_de_nombre(r.partido_nombre), "regla"
        peso_fam: dict[str, float] = {}
        for p, f in socios:
            peso_fam[f] = peso_fam.get(f, 0.0) + fuerza_partido.get(p, por_defecto)
        tot = sum(peso_fam.values())
        for f, w in peso_fam.items():
            filas.append({"eleccion": r.eleccion, "partido_cod": r.partido_cod, "partido_nombre": r.partido_nombre,
                          "votos_lista": int(r.votos), "familia_id": f, "peso": round(w / tot, 6),
                          "socios": "+".join(p for p, _ in socios), "coalicion_multifamilia": len(peso_fam) > 1,
                          "fuente": fuente})
    return pd.DataFrame(filas)
