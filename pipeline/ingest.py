"""Fase 1 — Ingesta y limpieza de resultados del Concejo (MMV por mesa) y del censo electoral por puesto.

Uso: ``python -m pipeline.ingest``
"""
from __future__ import annotations

import io
import json
import zipfile
from collections import Counter

import numpy as np
import pandas as pd

from . import config as C
from .textnorm import LOCALIDADES, SpaceRepairer, normalize_text, parse_localidad_codigo, text_key

MMV_COLUMNS = {
    "CODIGO ZONA": "zona", "CODIGO PUESTO": "puesto", "NOMBRE PUESTO": "puesto_nombre_raw", "MESA": "mesa",
    "CODIGO COMUNA": "comuna_cod", "NOMBRE COMUNA": "comuna_nombre_raw", "NOMBRE CORPORACION": "corporacion",
    "CODIGO PARTIDO": "partido_cod", "NOMBRE PARTIDO": "partido_nombre_raw",
    "CODIGO CANDIDATO": "candidato_cod", "NOMBRE CANDIDATO": "candidato_nombre_raw", "TOTAL VOTOS": "votos",
}
TIPO_ESPECIAL = {"00996": "blanco", "00997": "nulo", "00998": "no_marcado"}
TEXT_FIELDS = {"puesto_nombre_raw": "puesto_nombre", "partido_nombre_raw": "partido_nombre",
               "candidato_nombre_raw": "candidato_nombre", "comuna_nombre_raw": "comuna_nombre"}

CENSO_COLUMNS = ["anio", "tipo_eleccion", "departamento_cod", "departamento", "municipio_cod", "municipio",
                 "zona", "puesto", "puesto_nombre_raw", "hombres", "mujeres", "otros", "potencial",
                 "e18_20", "e21_25", "e26_30", "e31_35", "e36_40", "e41_45", "e46_50", "e51_55", "e56_60",
                 "e60_mas", "e_sin_fecha", "extranjero"]
EDADES = CENSO_COLUMNS[13:24]


def _decode(raw: bytes, log: dict, name: str) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        log.setdefault("advertencias", []).append(f"{name}: no es UTF-8, se leyó como cp1252")
        return raw.decode("cp1252")


def leer_mmv(year: int, log: dict) -> pd.DataFrame:
    path = C.MMV_ZIP[year]
    parts = []
    with zipfile.ZipFile(path) as zf:
        member = next(n for n in zf.namelist() if n.upper().endswith(".CSV") and "MMV" in n.upper())
        log["archivo"] = f"{path.name}!{member}"
        filas = 0
        with zf.open(member) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8-sig", newline="", errors="strict")
            for chunk in pd.read_csv(text, dtype=str, chunksize=400_000, keep_default_na=False):
                filas += len(chunk)
                chunk.columns = [text_key(c) for c in chunk.columns]
                faltantes = set(MMV_COLUMNS) - set(chunk.columns)
                if faltantes:
                    raise ValueError(f"{member}: faltan columnas {sorted(faltantes)}")
                chunk = chunk[list(MMV_COLUMNS)].rename(columns=MMV_COLUMNS)
                corp = chunk["corporacion"].str.strip().str.upper()
                parts.append(chunk[corp.isin(["CONCEJO", "ALCALDE"])].assign(corporacion=corp))
    log["filas_archivo"] = filas
    return pd.concat(parts, ignore_index=True)


def _map_unique(series: pd.Series, fn) -> pd.Series:
    uniques = pd.unique(series)
    return series.map(dict(zip(uniques, (fn(u) for u in uniques))))


def limpiar_mmv(df: pd.DataFrame, year: int, repairer: SpaceRepairer, log: dict) -> pd.DataFrame:
    for col, width in (("zona", 2), ("puesto", 2), ("comuna_cod", 2), ("partido_cod", 5), ("candidato_cod", 5)):
        df[col] = df[col].str.strip().str.zfill(width)

    votos = pd.to_numeric(df["votos"].str.strip(), errors="coerce")
    log["votos_no_numericos"] = int(votos.isna().sum())
    log["votos_negativos"] = int((votos < 0).sum())
    df["votos"] = votos.fillna(0).clip(lower=0).astype("int32")
    df["mesa"] = pd.to_numeric(df["mesa"].str.strip(), errors="coerce").astype("int32")

    cambios = Counter()
    for raw, out in TEXT_FIELDS.items():
        norm = _map_unique(df[raw], normalize_text)
        fixed = _map_unique(norm, repairer.repair)
        uniq = df[[raw]].assign(n=norm, f=fixed).drop_duplicates(raw)
        cambios[f"{out}: normalizados"] += int((uniq[raw] != uniq["n"]).sum())
        cambios[f"{out}: espacios_rotos_reparados"] += int((uniq["n"] != uniq["f"]).sum())
        df[out] = fixed
    log["textos_corregidos"] = dict(cambios)

    zona = df["zona"].astype(int)
    loc_nombre = _map_unique(df["comuna_nombre"], parse_localidad_codigo)
    inconsistentes = (zona <= 20) & (loc_nombre != zona)
    log["localidad_inconsistente_con_zona"] = int(inconsistentes.sum())
    df["localidad_cod"] = zona.astype("int16")
    df["localidad"] = df["localidad_cod"].map(LOCALIDADES)
    log["comunas_originales"] = sorted(df["comuna_nombre_raw"].unique().tolist())

    df["tipo"] = df["candidato_cod"].map(TIPO_ESPECIAL)
    df.loc[df["tipo"].isna() & (df["candidato_cod"] == "00000"), "tipo"] = "lista"
    df["tipo"] = df["tipo"].fillna("candidato")

    clave = ["corporacion", "zona", "puesto", "mesa", "partido_cod", "candidato_cod"]
    # Mismo código de candidato para dos personas distintas: anomalía de la fuente, no duplicado.
    codigo_repetido = df.duplicated(clave, keep=False) & ~df.duplicated(clave + ["candidato_nombre"], keep=False)
    log["codigo_candidato_compartido_por_personas_distintas"] = (
        df.loc[codigo_repetido & (df["corporacion"] == "CONCEJO"), ["partido_cod", "candidato_cod", "candidato_nombre"]]
        .drop_duplicates().to_dict("records"))
    dup_exacto = df.duplicated(clave + ["candidato_nombre", "votos"], keep="first")
    log["duplicados_exactos_eliminados"] = int(dup_exacto.sum())
    log["muestra_duplicados_exactos"] = df.loc[dup_exacto, clave + ["candidato_nombre", "votos"]].head(20).to_dict("records")
    df = df[~dup_exacto]
    log["filas_con_cero_votos"] = int((df["votos"] == 0).sum())

    df["anio"] = np.int16(year)
    df["puesto_id"] = df["zona"] + df["puesto"]
    return df


def leer_censo(year: int, log: dict) -> pd.DataFrame:
    path = C.CENSO_CSV[year]
    text = _decode(path.read_bytes(), log, path.name)
    df = pd.read_csv(io.StringIO(text), header=None, dtype=str, keep_default_na=False)
    h1, h2 = [text_key(x) for x in df.iloc[0]], [text_key(x) for x in df.iloc[1]]
    esperado = {0: (h1, "ANO"), 8: (h1, "PUESTO DE VOTACION"), 12: (h1, "POTENCIAL ELECTORAL"),
                9: (h2, "HOMBRES"), 10: (h2, "MUJERES"), 13: (h2, "18 20"), 22: (h2, "MAS DE 60"),
                24: (h2, "EXTRANJERO")}
    for idx, (fila, etiqueta) in esperado.items():
        if fila[idx] != etiqueta:
            raise ValueError(f"{path.name}: encabezado inesperado en columna {idx}: {fila[idx]!r} != {etiqueta!r}")
    df = df.iloc[2:].reset_index(drop=True)
    df.columns = CENSO_COLUMNS
    num = ["hombres", "mujeres", "otros", "potencial", *EDADES, "extranjero"]
    for col in num:
        df[col] = pd.to_numeric(df[col].str.strip().str.replace(".", "", regex=False).str.replace(",", "", regex=False),
                                errors="raise").astype("int32")
    df["zona"] = df["zona"].str.strip().str.zfill(2)
    df["puesto"] = df["puesto"].str.strip().str.zfill(2)
    df["puesto_id"] = df["zona"] + df["puesto"]
    df["puesto_nombre"] = df["puesto_nombre_raw"].map(normalize_text)
    df["anio"] = np.int16(year)

    sexo_ok = (df["hombres"] + df["mujeres"] + df["otros"]) == df["potencial"]
    # "extranjero" es una categoría aparte de los rangos de edad: rangos + extranjero = potencial
    edad_ok = (df[EDADES].sum(axis=1) + df["extranjero"]) == df["potencial"]
    log.update({
        "puestos": int(len(df)), "potencial_total": int(df["potencial"].sum()),
        "filas_sexo_no_cuadra": int((~sexo_ok).sum()), "filas_edad_no_cuadra": int((~edad_ok).sum()),
        "puestos_duplicados": int(df["puesto_id"].duplicated().sum()),
    })
    return df.drop(columns=["puesto_nombre_raw", "tipo_eleccion", "departamento", "municipio"])


def main() -> None:
    reporte: dict = {"ingesta": {}, "censo": {}}
    crudos, logs = {}, {}
    for year in C.YEARS:
        logs[year] = {}
        print(f"Leyendo MMV {year}…")
        crudos[year] = leer_mmv(year, logs[year])

    corpus = set()
    for df in crudos.values():
        for raw in TEXT_FIELDS:
            corpus.update(normalize_text(v) for v in pd.unique(df[raw]))
    overrides = {}
    corr = C.REFERENCE / "correcciones_texto.csv"
    if corr.exists():
        overrides = dict(pd.read_csv(corr, dtype=str, keep_default_na=False)[["original", "corregido"]].values)
    repairer = SpaceRepairer(corpus, overrides=overrides)

    for year in C.YEARS:
        log = logs[year]
        df = limpiar_mmv(crudos.pop(year), year, repairer, log)
        concejo = df[df["corporacion"] == "CONCEJO"]
        cols = ["anio", "zona", "puesto", "puesto_id", "puesto_nombre", "mesa", "localidad_cod", "localidad",
                "partido_cod", "partido_nombre", "candidato_cod", "candidato_nombre", "tipo", "votos"]
        concejo[cols].to_parquet(C.INTERIM / f"concejo_{year}.parquet", index=False)
        alcaldia = (df[df["corporacion"] == "ALCALDE"]
                    .groupby(["partido_cod", "partido_nombre", "candidato_cod", "candidato_nombre", "tipo"],
                             as_index=False)["votos"].sum().sort_values("votos", ascending=False))
        alcaldia.to_csv(C.INTERIM / f"alcaldia_{year}.csv", index=False, encoding="utf-8")

        log["filas_concejo"] = int(len(concejo))
        log["puestos_concejo"] = int(concejo["puesto_id"].nunique())
        log["mesas_concejo"] = int(concejo[["puesto_id", "mesa"]].drop_duplicates().shape[0])
        log["votos_concejo_por_tipo"] = {k: int(v) for k, v in concejo.groupby("tipo")["votos"].sum().items()}
        reporte["ingesta"][year] = log
        print(f"  {year}: {log['filas_concejo']:,} filas Concejo · {log['puestos_concejo']} puestos · "
              f"duplicados exactos {log['duplicados_exactos_eliminados']}")

        clog: dict = {}
        censo = leer_censo(year, clog)
        censo.to_parquet(C.INTERIM / f"censo_{year}.parquet", index=False)
        puestos_mmv = set(concejo["puesto_id"])
        clog["puestos_mmv_sin_censo"] = sorted(puestos_mmv - set(censo["puesto_id"]))
        clog["puestos_censo_sin_mmv"] = sorted(set(censo["puesto_id"]) - puestos_mmv)
        reporte["censo"][year] = clog

    reporte["reparacion_espacios"] = {"cambios": sorted(set(repairer.changes)),
                                      "ambiguos_para_revision": sorted(set(repairer.flagged))}
    (C.REPORTS / "calidad_ingesta.json").write_text(json.dumps(reporte, ensure_ascii=False, indent=2, default=str),
                                                    encoding="utf-8")
    print("OK → data/interim, reports/calidad_ingesta.json")


if __name__ == "__main__":
    main()
