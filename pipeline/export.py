"""Fase 6 — Exportación de datos compactos para la aplicación web (``web/public/data``).

Uso: ``python -m pipeline.export``
"""
from __future__ import annotations

import json
import math

import geopandas as gpd
import numpy as np
import pandas as pd

from . import config as C
from .partidos import FAMILIAS, FAMILIA_IDS, LISTAS_INFO
from .textnorm import LOCALIDADES, title_case_es

OUT = C.WEB_DATA
FIX = C.ROOT / "web" / "src" / "lib" / "__fixtures__"


def _limpio(o):
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else round(o, 5)
    if isinstance(o, (np.floating,)):
        return _limpio(float(o))
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, dict):
        return {str(k): _limpio(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, np.ndarray)):
        return [_limpio(v) for v in o]
    return o


def escribir(nombre: str, datos, carpeta=OUT) -> None:
    carpeta.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(_limpio(datos), ensure_ascii=False, separators=(",", ":"))
    (carpeta / nombre).write_text(texto, encoding="utf-8")
    print(f"  {nombre:28s} {len(texto.encode('utf-8')) / 1024:8.1f} KB")


def main() -> None:
    analisis = json.loads((C.PROCESSED / "analisis.json").read_text(encoding="utf-8"))
    modelo = json.loads((C.PROCESSED / "modelo.json").read_text(encoding="utf-8"))
    listas = pd.read_csv(C.PROCESSED / "concejo_listas.csv")
    hist = pd.read_csv(C.REFERENCE / "concejo_historico.csv")
    pr, bt = modelo["pronostico"], modelo["backtest_2023"]

    # ── meta ──
    familias = FAMILIAS.rename(columns={"familia_id": "id"}).to_dict("records")
    consultas_nombres = sorted(pd.read_parquet(C.PROCESSED / "consultas_2026_upz.parquet")["partido_nombre"].unique().tolist())
    escribir("meta.json", {"familias": familias, "localidades": {k: v for k, v in LOCALIDADES.items() if k <= 20},
                           "generado": modelo["generado"], "eleccion": modelo["eleccion"],
                           "listas": {k: {"nombre": v[0], "familia": v[1]} for k, v in LISTAS_INFO.items()},
                           "consultas_2026": consultas_nombres})

    # ── resultados por lista ──
    res = {}
    for anio in C.YEARS:
        L = listas[listas["anio"] == anio].sort_values("votos", ascending=False)
        c = analisis["ciudad"][str(anio)]
        v = json.loads((C.REPORTS / "calidad_agregados.json").read_text(encoding="utf-8"))[f"validacion_curules_{anio}"]
        filas = []
        for r in L.itertuples():
            filas.append({"id": r.lista_id, "nombre": r.nombre, "familia": r.familia_id, "votos": int(r.votos),
                          "votos_lista": int(np.nan_to_num(getattr(r, "votos_lista", 0))),
                          "votos_candidato": int(np.nan_to_num(getattr(r, "votos_candidato", 0))),
                          "pct": r.votos / c["validos"], "curules": int(r.curules_repartidora),
                          "oposicion": int(r.curul_oposicion), "supera_umbral": bool(r.supera_umbral),
                          "faltan_para_otra": int(r.votos_para_otra_curul), "colchon": int(r.colchon_ultima_curul)})
        op = C.CURULES_OFICIALES[anio]["oposicion"]
        if op not in set(L["lista_id"]):
            filas.append({"id": op, "nombre": LISTAS_INFO[op][0], "familia": LISTAS_INFO[op][1], "votos": 0,
                          "votos_lista": 0, "votos_candidato": 0, "pct": 0, "curules": 0, "oposicion": 1,
                          "supera_umbral": False, "faltan_para_otra": 0, "colchon": 0, "sin_lista": True})
        # tabla de cocientes para el explicador de la cifra repartidora
        top = L[L["supera_umbral"]]
        cocientes = [{"id": r.lista_id, "q": [r.votos / d for d in range(1, 14)]} for r in top.itertuples()]
        res[str(anio)] = {"ciudad": c, "listas": filas, "cociente": v["cociente"], "umbral": v["umbral"],
                          "cifra_repartidora": v["cifra_repartidora"], "cocientes": cocientes}
    # histórico por familia 2011–2023
    fam_hist = {}
    for anio, g in hist.groupby("anio"):
        vv = g.groupby("familia_id")["votos"].sum()
        validos = vv.drop(["nulo", "no_marcado"], errors="ignore").sum()
        cur = g.groupby("familia_id")["curules"].sum()
        fam_hist[str(anio)] = {f: {"cuota": float(vv.get(f, 0) / validos), "curules": int(cur.get(f, 0))} for f in FAMILIA_IDS + ["blanco"]}
    for anio in C.YEARS:
        L = listas[listas["anio"] == anio]
        cur = (L.groupby("familia_id")["curules_repartidora"].sum() + L.groupby("familia_id")["curul_oposicion"].sum())
        fam_hist[str(anio)] = {f: {"cuota": analisis["ciudad"][str(anio)]["familias_pct_validos"][f], "curules": int(cur.get(f, 0))}
                               for f in FAMILIA_IDS}
        fam_hist[str(anio)]["blanco"] = {"cuota": analisis["ciudad"][str(anio)]["pct_blanco"], "curules": 0}
    if "con_toda_por_bogota" not in set(listas["lista_id"]):
        fam_hist["2023"]["otros"]["curules"] += 1
    res["historico_familias"] = fam_hist
    res["pedersen_familias"] = analisis["ciudad"]["pedersen_familias_2019_2023"]
    res["pedersen_listas"] = analisis["ciudad"]["pedersen_listas_2019_2023"]
    escribir("resultados.json", res)

    # fixture de prueba compartido Python ↔ TypeScript
    casos = []
    for anio in C.YEARS:
        L = listas[listas["anio"] == anio]
        casos.append({"anio": anio, "blancos": res[str(anio)]["ciudad"]["blanco"],
                      "listas": [{"id": r.lista_id, "votos": int(r.votos)} for r in L.itertuples()],
                      "esperado": {r.lista_id: int(r.curules_repartidora) for r in L.itertuples()}})
    escribir("dhondt_casos.json", casos, FIX)

    # ── geometrías ──
    upz = gpd.read_file(C.UPZ_GEOJSON)
    if upz.crs is None:
        upz = upz.set_crs(4326)
    upz = upz.to_crs(4326)
    upz["geometry"] = upz.geometry.simplify(0.00025, preserve_topology=True)
    upz["cod"] = upz["UPLCODIGO"]
    upz["nombre"] = upz["UPLNOMBRE"].map(title_case_es)
    upz["localidad"] = pd.to_numeric(upz["LOCCODIGO"], errors="coerce").fillna(0).astype(int)
    geo_upz = json.loads(upz[["cod", "nombre", "localidad", "geometry"]].to_json(drop_id=True))
    for f in geo_upz["features"]:
        f["geometry"]["coordinates"] = _redondear(f["geometry"]["coordinates"])
    escribir("upz.geojson", geo_upz)
    loc = upz.dissolve(by="localidad", as_index=False)[["localidad", "geometry"]]
    loc["geometry"] = loc.geometry.simplify(0.0004, preserve_topology=True)
    loc["nombre"] = loc["localidad"].map(LOCALIDADES)
    geo_loc = json.loads(loc.to_json(drop_id=True))
    for f in geo_loc["features"]:
        f["geometry"]["coordinates"] = _redondear(f["geometry"]["coordinates"])
    escribir("localidades.geojson", geo_loc)

    # ── capas del mapa por UPZ y localidad ──
    iu = pd.read_parquet(C.PROCESSED / "indicadores_upz.parquet")
    il = pd.read_parquet(C.PROCESSED / "indicadores_localidad.parquet")
    lisa = pd.read_parquet(C.PROCESSED / "lisa_upz.parquet")
    elecciones = ["concejo_2019", "concejo_2023", "camara_2022", "camara_2026", "presidente_2022", "presidente_2026"]
    capas = {"upz": {}, "localidad": {}}
    for nivel, df, key in (("upz", iu, "upz_cod"), ("localidad", il, "localidad_cod")):
        for el in elecciones:
            d = df[df["eleccion"] == el]
            capas[nivel][el] = {str(r[key]): _fila_capa(r) for _, r in d.iterrows()}
    capas["upz"]["proyeccion_2027"] = {cod: {"cuotas": {f: v.get(f, 0) for f in FAMILIA_IDS}, "blanco": v.get("blanco", 0),
                                             "ganador": max(FAMILIA_IDS, key=lambda f: v.get(f, 0))}
                                       for cod, v in modelo["proyeccion_upz"]["upz"].items()}
    capas["lisa"] = {var: dict(zip(g["upz_cod"], g["cluster"])) for var, g in lisa.groupby("variable")}
    capas["moran"] = analisis["moran_global"]

    # ── consultas interpartidistas 2026 ──
    # Viven fuera del modelo de 9 familias (son coaliciones ad-hoc, no
    # partidos individuales) — capa aparte, agregada por lista/coalición
    # en vez de por familia. Ver pipeline/aggregate.py, sección 4.1.
    cons = pd.read_parquet(C.PROCESSED / "consultas_2026_upz.parquet")
    capa_consultas = {}
    for upz_cod, g in cons.groupby("upz_cod"):
        total = int(g["votos"].sum())
        capa_consultas[upz_cod] = {
            "listas": {r.partido_nombre: round(r.votos / total, 4) for r in g.itertuples()} if total else {},
            "ganador": g.loc[g["votos"].idxmax(), "partido_nombre"] if total else None,
            "votos_totales": total,
        }
    capas["consulta_2026"] = capa_consultas

    # ── estructura de edad 2023 ──
    # Coroplético por UPZ/localidad (dato observado: agregación directa del censo electoral) +
    # pirámide hombres/mujeres por tramo (ESTIMADA: el censo trae sexo y edad como marginales
    # separadas por puesto, no cruzadas; se asume que la forma de la distribución de edad es
    # igual entre sexos dentro de cada zona — ver nota en pipeline/aggregate.py, sección 4.2).
    capas["edades"] = {}
    for nivel in ("upz", "localidad"):
        ed = pd.read_parquet(C.PROCESSED / f"edades_{nivel}.parquet")
        capa_nivel = {}
        for r in ed.itertuples():
            conocido = sum(getattr(r, c) for c in C.EDAD_COLS)
            piramide = []
            for col, borde in zip(C.EDAD_COLS, C.EDAD_BORDES):
                share = getattr(r, col) / conocido if conocido else 0.0
                piramide.append({
                    "tramo": "61+" if col == "e60_mas" else f"{borde}-{borde + (2 if col == 'e18_20' else 4)}",
                    "hombres_pct": round(share * r.hombres / r.potencial, 5) if r.potencial else 0.0,
                    "mujeres_pct": round(share * r.mujeres / r.potencial, 5) if r.potencial else 0.0,
                })
            capa_nivel[str(r.cod)] = {
                "potencial": int(r.potencial), "pct_18_30": round(r.pct_18_30, 4), "pct_60_mas": round(r.pct_60_mas, 4),
                "mediana": round(r.mediana, 1) if r.mediana is not None else None,
                "hombres_pct": round(r.hombres / r.potencial, 4) if r.potencial else None,
                "mujeres_pct": round(r.mujeres / r.potencial, 4) if r.potencial else None,
                "piramide": piramide,
            }
        capas["edades"][nivel] = capa_nivel

    escribir("capas.json", capas)

    # puestos 2023 (columnar)
    geo = pd.read_parquet(C.PROCESSED / "puestos_geo.parquet")
    cat = pd.read_parquet(C.PROCESSED / "votos_puesto_categoria.parquet")
    censo = pd.read_parquet(C.INTERIM / "censo_2023.parquet")[["puesto_id", "potencial"]]
    g23 = geo[(geo["eleccion"] == "concejo_2023") & geo["lon"].notna() & (geo["localidad_cod"] <= 20)]
    p = cat[cat["eleccion"] == "concejo_2023"].pivot_table(index="puesto_id", columns="categoria", values="votos", aggfunc="sum", fill_value=0)
    p["validos"] = p[FAMILIA_IDS].sum(axis=1) + p["blanco"]
    p["votantes"] = p["validos"] + p["nulo"] + p["no_marcado"]
    g23 = g23.merge(p, left_on="puesto_id", right_index=True).merge(censo, on="puesto_id", how="left")
    escribir("puestos_2023.json", {
        "id": g23["puesto_id"].tolist(), "nombre": g23["puesto_nombre"].map(title_case_es).tolist(),
        "lon": g23["lon"].round(5).tolist(), "lat": g23["lat"].round(5).tolist(),
        "localidad": g23["localidad_cod"].astype(int).tolist(), "upz": g23["upz_cod"].tolist(),
        "validos": g23["validos"].round().astype(int).tolist(),
        "participacion": (g23["votantes"] / g23["potencial"]).round(3).tolist(),
        "cuotas": {f: (g23[f] / g23["validos"]).round(3).tolist() for f in FAMILIA_IDS + ["blanco"]},
    })

    # ── territorio ──
    loc_out = {}
    for cod in range(1, 21):
        filas = il[il["localidad_cod"] == cod].set_index("eleccion")
        loc_out[str(cod)] = {"nombre": LOCALIDADES[cod], "volatilidad": analisis["volatilidad_localidad"].get(str(cod)),
                             "series": {el: _fila_capa(filas.loc[el]) for el in filas.index}}
    escribir("territorio.json", {"localidades": loc_out, "demografia": analisis["demografia"],
                                 "moran": analisis["moran_global"]})

    # ── candidatos ──
    cands = pd.read_parquet(C.PROCESSED / "candidatos.parquet")
    cands["lista_nombre"] = cands["lista_id"].map(lambda x: LISTAS_INFO[x][0])
    cols = ["anio", "nombre", "lista_id", "lista_nombre", "familia_id", "votos", "pct_de_lista", "rank_lista", "elegido",
            "localidad_fuerte", "pct_localidad_fuerte", "gini_puestos", "compitio_ambos", "similitud_territorial",
            "vector_localidades", "clave"]
    escribir("candidatos.json", cands[cols].sort_values(["anio", "votos"], ascending=[True, False]).to_dict("records"))

    # ── pronóstico ──
    pron = {k: v for k, v in pr.items() if k not in ("muestra",)}
    pron["volatilidad"] = {k: v for k, v in pr["volatilidad"].items()}
    escribir("pronostico.json", {"generado": modelo["generado"], "eleccion": modelo["eleccion"],
                                 "n_simulaciones": modelo["n_simulaciones"], "pronostico": pron, "backtest": bt,
                                 "participacion": modelo["participacion"],
                                 "beta_local": modelo["proyeccion_upz"]["beta_persistencia_local"],
                                 "cuotas_historicas": modelo["cuotas_historicas"]})
    escribir("simulaciones.json", pr["muestra"])

    # ── matriz de transferencia (diagnóstico completo, para la página de metodología) ──
    trans_path = C.PROCESSED / "transferencia.json"
    if trans_path.exists():
        escribir("transferencia.json", json.loads(trans_path.read_text(encoding="utf-8")))

    # ── escenarios con hipótesis (Fase 3) — rotulados, nunca el pronóstico por defecto ──
    esc_path = C.PROCESSED / "escenarios_ia.json"
    if esc_path.exists():
        escribir("escenarios_ia.json", json.loads(esc_path.read_text(encoding="utf-8")))

    # ── simulador: base central por lista ──
    base = []
    for l in pr["listas"]:
        base.append({"id": l["id"], "nombre": l["nombre"], "familia": l["familia"], "cuota": l["cuota"]["p50"],
                     "cuota_2023": next((x["pct"] for x in res["2023"]["listas"] if x["id"] == l["id"]), 0)})
    tot = sum(b["cuota"] for b in base) + pr["blanco"]["p50"]
    for b in base:
        b["cuota"] /= tot
    escribir("simulador.json", {"listas": base, "blanco": pr["blanco"]["p50"] / tot,
                                "blanco_2023": res["2023"]["ciudad"]["pct_blanco"],
                                "validos_2027": modelo["participacion"]["validos"]["p50"],
                                "participacion_2027": modelo["participacion"]["participacion"]["p50"],
                                "potencial_2027": modelo["participacion"]["potencial_2027"]})

    # ── calidad ──
    ingesta = json.loads((C.REPORTS / "calidad_ingesta.json").read_text(encoding="utf-8"))
    externas = json.loads((C.REPORTS / "calidad_externas.json").read_text(encoding="utf-8"))
    agregados = json.loads((C.REPORTS / "calidad_agregados.json").read_text(encoding="utf-8"))
    xw = pd.read_csv(C.REFERENCE / "partidos_crosswalk.csv", dtype={"partido_cod": str})
    escribir("calidad.json", {
        "ingesta": {a: {k: v for k, v in l.items() if k not in ("comunas_originales", "muestra_duplicados_exactos")}
                    for a, l in ingesta["ingesta"].items()},
        "censo": ingesta["censo"], "reparacion_espacios": ingesta["reparacion_espacios"],
        "comunas_originales": {a: l["comunas_originales"] for a, l in ingesta["ingesta"].items()},
        "externas": externas, "geocodificacion": agregados["geocodificacion"],
        "validacion_curules": {a: agregados[f"validacion_curules_{a}"] for a in C.YEARS},
        "crosswalk": xw[xw["votos_lista"] > 2000][["eleccion", "partido_nombre", "votos_lista", "familia_id", "peso", "fuente"]].to_dict("records"),
    })
    print("OK → web/public/data")


def _fila_capa(r) -> dict:
    return {"cuotas": {f: _num(r.get(f"pct_{f}")) for f in FAMILIA_IDS}, "blanco": _num(r.get("pct_blanco")),
            "participacion": _num(r.get("participacion")), "validos": int(r.get("validos", 0) or 0),
            "ganador": r.get("ganador"), "margen": _num(r.get("margen"))}


def _num(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), 4)


def _redondear(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 5), round(coords[1], 5)]
    return [_redondear(c) for c in coords]


if __name__ == "__main__":
    main()
