"""Fases 2–3 — Geocodificación de puestos, familias políticas y agregados por puesto / UPZ / localidad / ciudad.

Uso: ``python -m pipeline.aggregate``
"""
from __future__ import annotations

import json

import geopandas as gpd
import numpy as np
import pandas as pd
from rapidfuzz import fuzz

from . import config as C
from .partidos import CONCEJO_LISTAS, FAMILIA_IDS, LISTAS_INFO, PRESIDENCIALES, construir_crosswalk
from .seats import cifra_repartidora
from .textnorm import LOCALIDADES, text_key, title_case_es

REPORTE: dict = {}


# ───────────────────────── votos en esquema común ─────────────────────────

def cargar_votos() -> pd.DataFrame:
    frames = []
    claves = ["eleccion", "corporacion", "puesto_id", "zona", "puesto_nombre", "partido_cod", "partido_nombre",
              "candidato_cod", "candidato_nombre", "tipo"]
    for y in C.YEARS:
        d = pd.read_parquet(C.INTERIM / f"concejo_{y}.parquet")
        d["eleccion"], d["corporacion"] = f"concejo_{y}", "CONCEJO"
        d["candidato_cod"] = d["candidato_cod"].str[-3:]
        frames.append(d.groupby(claves, as_index=False)["votos"].sum())
    for p in sorted((C.INTERIM / "externas").glob("*.parquet")):
        if not p.name.startswith("divipol_"):
            frames.append(pd.read_parquet(p)[claves + ["votos"]])
    camara18 = C.EXTERNAL / "camara2018" / "camara2018_bogota_puesto.csv"
    if camara18.exists():
        frames.append(_camara_2018(camara18)[claves + ["votos"]])
    votos = pd.concat(frames, ignore_index=True)
    votos["localidad_cod"] = votos["zona"].astype(int)
    return votos


def _camara_2018(path) -> pd.DataFrame:
    """Cámara 2018 Bogotá (datos.gov.co, publicado por la Registraduría) — sin códigos de partido/candidato."""
    d = pd.read_csv(path, dtype=str, keep_default_na=False)
    d["votos"] = pd.to_numeric(d["votos"], errors="coerce").fillna(0).astype("int64")
    d["zona"], d["puesto"] = d["zz"].str.zfill(2), d["pp"].str.zfill(2)
    k = d["candidato"].map(text_key)
    tipo = np.select([k == "VOTOS EN BLANCO", k == "VOTOS NULOS", k == "VOTOS NO MARCADOS", k == "SOLO POR EL PARTIDO"],
                     ["blanco", "nulo", "no_marcado", "lista"], "candidato")
    partido = d["partido"].where(d["partido"] != "", "")
    codigos = {n: f"{i + 1:05d}" for i, n in enumerate(sorted(set(partido) - {""}))}
    return pd.DataFrame({
        "eleccion": "camara_2018", "corporacion": "CAMARA", "puesto_id": d["zona"] + d["puesto"], "zona": d["zona"],
        "puesto_nombre": d["npuesto"].map(lambda s: text_key(s) and s.upper()), "partido_cod": partido.map(codigos).fillna("00000"),
        "partido_nombre": partido, "candidato_cod": np.where(tipo == "lista", "000", "001"),
        "candidato_nombre": d["candidato"], "tipo": tipo, "votos": d["votos"],
    }).groupby(["eleccion", "corporacion", "puesto_id", "zona", "puesto_nombre", "partido_cod", "partido_nombre",
                "candidato_cod", "candidato_nombre", "tipo"], as_index=False)["votos"].sum()


# ───────────────────────── geocodificación ─────────────────────────

def cargar_geo() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    upz = gpd.read_file(C.UPZ_GEOJSON)
    if upz.crs is None:
        upz = upz.set_crs(4326)
    upz = upz.to_crs(4326)
    pts = gpd.read_file(C.PUESTOS_GEOJSON).to_crs(4326)
    pts["codigo"] = pts["Código_del_puesto"].astype(str).str.zfill(9)
    pts["zona"], pts["puesto_id"] = pts["codigo"].str[5:7], pts["codigo"].str[5:9]
    pts["k_puesto"] = pts["Nombre_del_puesto"].map(text_key)
    pts["k_sitio"] = pts["Nombre_del_Sitio"].map(text_key)
    cols = ["UPLCODIGO", "UPLNOMBRE", "LOCCODIGO", "geometry"]
    j = gpd.sjoin(pts, upz[cols], how="left", predicate="within").drop(columns="index_right")
    faltan = j["UPLCODIGO"].isna()
    if faltan.any():
        near = gpd.sjoin_nearest(pts[faltan].to_crs(3116), upz[cols].to_crs(3116), how="left").to_crs(4326)
        j.loc[faltan, ["UPLCODIGO", "UPLNOMBRE", "LOCCODIGO"]] = near[["UPLCODIGO", "UPLNOMBRE", "LOCCODIGO"]].values
    j["lon"], j["lat"] = j.geometry.x, j.geometry.y
    return j, upz


def geocodificar(puestos: pd.DataFrame, pts: gpd.GeoDataFrame) -> pd.DataFrame:
    """Empareja cada puesto (eleccion, puesto_id, zona, nombre) con un punto georreferenciado de su misma zona.

    Puntaje = similitud difusa del nombre (contra nombre del puesto y del sitio) + 15 si coincide el código.
    El código solo no basta: la Registraduría reutiliza números de puesto entre elecciones.
    """
    por_zona = {z: g.reset_index(drop=True) for z, g in pts.groupby("zona")}
    filas = []
    for r in puestos.itertuples(index=False):
        cand = por_zona.get(r.zona)
        base = {"eleccion": r.eleccion, "puesto_id": r.puesto_id, "puesto_nombre": r.puesto_nombre}
        if cand is None or cand.empty:
            filas.append({**base, "confianza": "sin_ubicacion", "similitud": 0.0})
            continue
        k = text_key(r.puesto_nombre)
        sim = np.array([max(fuzz.WRatio(k, a), fuzz.WRatio(k, b)) if k else 0.0
                        for a, b in zip(cand["k_puesto"], cand["k_sitio"])])
        score = sim + np.where(cand["puesto_id"] == r.puesto_id, 15, 0)
        i = int(score.argmax())
        mismo_codigo = cand.loc[i, "puesto_id"] == r.puesto_id
        conf = "alta" if sim[i] >= 86 else "media" if (sim[i] >= 70 or (mismo_codigo and sim[i] >= 50)) else "baja"
        filas.append({**base, "confianza": conf, "similitud": float(sim[i]), "geo_codigo": cand.loc[i, "puesto_id"],
                      "lon": cand.loc[i, "lon"], "lat": cand.loc[i, "lat"], "upz_cod": cand.loc[i, "UPLCODIGO"],
                      "upz_nombre": cand.loc[i, "UPLNOMBRE"]})
    return pd.DataFrame(filas)


# ───────────────────────── principal ─────────────────────────

def main() -> None:
    votos = cargar_votos()
    print(f"Votos cargados: {len(votos):,} filas · elecciones {sorted(votos['eleccion'].unique())}")

    # 1. Listas del Concejo (ids estables) y pesos de familia en 2023 para repartir coaliciones
    conc = votos[votos["corporacion"] == "CONCEJO"].copy()
    conc["anio"] = conc["eleccion"].str[-4:].astype(int)
    conc["lista_id"] = [CONCEJO_LISTAS.get((a, p)) for a, p in zip(conc["anio"], conc["partido_cod"])]
    partidistas = conc[conc["tipo"].isin(["lista", "candidato"])]
    sin_id = partidistas[partidistas["lista_id"].isna()][["eleccion", "partido_cod", "partido_nombre"]].drop_duplicates()
    if len(sin_id):
        raise ValueError(f"Listas del Concejo sin identificador: {sin_id.to_dict('records')}")
    conc["familia_id"] = conc["lista_id"].map(lambda x: LISTAS_INFO[x][1] if isinstance(x, str) else None)
    # fuerza propia de cada partido en el Concejo (máximo 2019/2023) para repartir coaliciones multifamilia
    fuerza = (conc[conc["lista_id"].notna()].groupby(["anio", "lista_id"])["votos"].sum()
              .groupby("lista_id").max().to_dict())

    # 2. Crosswalk para elecciones externas
    externas = votos[(votos["corporacion"] != "CONCEJO") & votos["tipo"].isin(["lista", "candidato"])]
    listas_ext = (externas.groupby(["eleccion", "partido_cod"])
                  .agg(partido_nombre=("partido_nombre", lambda s: s.mode().iat[0]), votos=("votos", "sum"))
                  .reset_index())
    xw = construir_crosswalk(listas_ext, fuerza)
    pres = externas[externas["corporacion"] == "PRESIDENTE"][["eleccion", "partido_cod", "candidato_nombre"]].drop_duplicates()
    pres_fam = {(r.eleccion, r.partido_cod): PRESIDENCIALES.get(text_key(r.candidato_nombre), "otros") for r in pres.itertuples()}
    es_pres = xw["eleccion"].str.startswith("presidente")
    xw.loc[es_pres, "familia_id"] = [pres_fam.get((e, p), "otros") for e, p in zip(xw.loc[es_pres, "eleccion"], xw.loc[es_pres, "partido_cod"])]
    xw.loc[es_pres, ["peso", "fuente"]] = [1.0, "candidato_presidencial"]
    xw = xw.drop_duplicates(["eleccion", "partido_cod", "familia_id"])
    conc_xw = (conc[conc["lista_id"].notna()].groupby(["eleccion", "partido_cod", "lista_id", "familia_id"], as_index=False)
               ["votos"].sum().rename(columns={"votos": "votos_lista"}))
    conc_xw["partido_nombre"] = conc_xw["lista_id"].map(lambda x: LISTAS_INFO[x][0])
    conc_xw["peso"], conc_xw["coalicion_multifamilia"], conc_xw["fuente"] = 1.0, False, "concejo_explicito"
    crosswalk = pd.concat([conc_xw, xw], ignore_index=True).sort_values(["eleccion", "votos_lista"], ascending=[True, False])
    crosswalk.to_csv(C.REFERENCE / "partidos_crosswalk.csv", index=False, encoding="utf-8")

    # 3. Votos por puesto × familia (incluye blanco/nulo/no marcado como categorías propias)
    w = crosswalk[["eleccion", "partido_cod", "familia_id", "peso"]]
    part = votos[votos["tipo"].isin(["lista", "candidato"])].merge(w, on=["eleccion", "partido_cod"], how="left")
    if part["familia_id"].isna().any():
        raise ValueError("Votos partidistas sin familia asignada")
    part["votos_f"] = part["votos"] * part["peso"]
    fam = part.groupby(["eleccion", "puesto_id", "familia_id"], as_index=False)["votos_f"].sum()
    fam = fam.rename(columns={"votos_f": "votos", "familia_id": "categoria"})
    esp = (votos[~votos["tipo"].isin(["lista", "candidato"])].groupby(["eleccion", "puesto_id", "tipo"], as_index=False)
           ["votos"].sum().rename(columns={"tipo": "categoria"}))
    cat = pd.concat([fam, esp], ignore_index=True)

    # 4. Geocodificación de puestos de cada elección
    pts, upz = cargar_geo()
    puestos = (votos.groupby(["eleccion", "puesto_id", "zona"])["puesto_nombre"].agg(lambda s: s.mode().iat[0])
               .reset_index())
    geo = geocodificar(puestos, pts)
    geo["localidad_cod"] = geo["puesto_id"].str[:2].astype(int)
    geo["localidad"] = geo["localidad_cod"].map(LOCALIDADES)
    REPORTE["geocodificacion"] = {e: g["confianza"].value_counts().to_dict() for e, g in geo.groupby("eleccion")}
    geo.to_parquet(C.PROCESSED / "puestos_geo.parquet", index=False)

    cat = cat.merge(geo[["eleccion", "puesto_id", "upz_cod", "localidad_cod", "confianza"]], on=["eleccion", "puesto_id"], how="left")
    cat.to_parquet(C.PROCESSED / "votos_puesto_categoria.parquet", index=False)

    # 5. Totales de ciudad por elección y categoría
    ciudad = cat.groupby(["eleccion", "categoria"], as_index=False)["votos"].sum()
    ciudad.to_csv(C.PROCESSED / "ciudad_categoria.csv", index=False)

    # 6. Concejo: listas, candidatos y validación del reparto oficial
    listas = []
    for anio in C.YEARS:
        c = conc[(conc["anio"] == anio)]
        blancos = int(c.loc[c["tipo"] == "blanco", "votos"].sum())
        por_lista = c[c["lista_id"].notna()].groupby(["lista_id", "tipo"])["votos"].sum().unstack(fill_value=0)
        por_lista.columns = [f"votos_{t}" for t in por_lista.columns]
        por_lista["votos"] = por_lista.sum(axis=1)
        rep = cifra_repartidora(por_lista["votos"].to_dict(), blancos)
        oficial = C.CURULES_OFICIALES[anio]["repartidora"]
        calculado = {k: v for k, v in rep.curules.items() if v}
        REPORTE[f"validacion_curules_{anio}"] = {"coincide": calculado == oficial, "calculado": calculado, "oficial": oficial,
                                                 "cociente": rep.cociente, "umbral": rep.umbral,
                                                 "cifra_repartidora": rep.cifra_repartidora}
        print(f"Curules {anio}: {'✓ coincide con la composición oficial' if calculado == oficial else '✗ NO coincide'}")
        por_lista = por_lista.reset_index()
        por_lista["familia_id"] = por_lista["lista_id"].map(lambda x: LISTAS_INFO[x][1])
        por_lista["anio"] = anio
        por_lista["nombre"] = por_lista["lista_id"].map(lambda x: LISTAS_INFO[x][0])
        por_lista["curules_repartidora"] = por_lista["lista_id"].map(rep.curules).fillna(0).astype(int)
        por_lista["curul_oposicion"] = (por_lista["lista_id"] == C.CURULES_OFICIALES[anio]["oposicion"]).astype(int)
        por_lista["votos_para_otra_curul"] = por_lista["lista_id"].map(rep.votos_para_otra_curul)
        por_lista["colchon_ultima_curul"] = por_lista["lista_id"].map(rep.colchon_ultima_curul)
        por_lista["supera_umbral"] = por_lista["votos"] >= rep.umbral
        listas.append(por_lista)
    listas = pd.concat(listas, ignore_index=True)
    listas.to_csv(C.PROCESSED / "concejo_listas.csv", index=False, encoding="utf-8")

    cands = conc[conc["tipo"] == "candidato"].copy()
    cands["candidato_display"] = cands["candidato_nombre"].map(title_case_es)
    cands.groupby(["anio", "lista_id", "familia_id", "candidato_cod", "candidato_nombre", "candidato_display",
                   "puesto_id"], as_index=False)["votos"].sum().to_parquet(C.PROCESSED / "concejo_candidatos_puesto.parquet", index=False)

    (C.REPORTS / "calidad_agregados.json").write_text(json.dumps(REPORTE, ensure_ascii=False, indent=2, default=str),
                                                     encoding="utf-8")
    print(json.dumps(REPORTE["geocodificacion"], ensure_ascii=False))
    print("OK → data/processed")


if __name__ == "__main__":
    main()
