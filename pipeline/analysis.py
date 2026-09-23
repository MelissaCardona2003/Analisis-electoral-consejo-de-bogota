"""Fase 4 — Indicadores y análisis del Concejo.

Participación y voto no válido · fragmentación (NEP) · volatilidad (Pedersen) · desproporcionalidad (Gallagher)
· geografía por localidad y UPZ con autocorrelación espacial (Moran/LISA) · candidatos · demografía ecológica.

Uso: ``python -m pipeline.analysis``
"""
from __future__ import annotations

import json
import warnings

import geopandas as gpd
import numpy as np
import pandas as pd

from . import config as C
from .partidos import FAMILIA_IDS, LISTAS_INFO
from .textnorm import LOCALIDADES, text_key

NO_PARTIDISTAS = ["blanco", "nulo", "no_marcado"]


# ───────────────────────── índices ─────────────────────────

def nep(shares) -> float:
    s = np.asarray(list(shares), dtype=float)
    s = s[s > 0]
    s = s / s.sum()
    return float(1.0 / np.sum(s ** 2))


def pedersen(a: dict, b: dict) -> float:
    ka, kb = sum(a.values()), sum(b.values())
    return float(0.5 * sum(abs(a.get(k, 0) / ka - b.get(k, 0) / kb) for k in set(a) | set(b)))


def gallagher(votos: dict, curules: dict) -> float:
    tv, ts = sum(votos.values()), sum(curules.values())
    return float(np.sqrt(0.5 * sum((100 * (votos.get(k, 0) / tv - curules.get(k, 0) / ts)) ** 2
                                   for k in set(votos) | set(curules))))


def gini(x) -> float:
    x = np.sort(np.asarray(x, dtype=float))
    if x.sum() == 0:
        return 0.0
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def ols_robusto(X: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, float]:
    """MCO ponderado con errores estándar robustos HC1. Devuelve (coef, ee, r2)."""
    n, k = X.shape
    w = np.ones(n) if w is None else w / w.mean()
    sw = np.sqrt(w)
    Xw, yw = X * sw[:, None], y * sw
    XtX_inv = np.linalg.pinv(Xw.T @ Xw)
    beta = XtX_inv @ Xw.T @ yw
    resid = yw - Xw @ beta
    meat = (Xw * resid[:, None] ** 2).T @ Xw
    cov = XtX_inv @ meat @ XtX_inv * n / max(n - k, 1)
    r2 = 1 - (resid ** 2).sum() / ((yw - yw.mean()) ** 2).sum()
    return beta, np.sqrt(np.diag(cov)), float(r2)


# ───────────────────────── carga ─────────────────────────

def cargar():
    cat = pd.read_parquet(C.PROCESSED / "votos_puesto_categoria.parquet")
    geo = pd.read_parquet(C.PROCESSED / "puestos_geo.parquet")
    listas = pd.read_csv(C.PROCESSED / "concejo_listas.csv")
    censos = {a: pd.read_parquet(C.INTERIM / f"censo_{a}.parquet") for a in C.YEARS}
    return cat, geo, listas, censos


def pivot_categorias(df: pd.DataFrame, idx: list[str]) -> pd.DataFrame:
    p = df.pivot_table(index=idx, columns="categoria", values="votos", aggfunc="sum", fill_value=0)
    for c in FAMILIA_IDS + NO_PARTIDISTAS:
        if c not in p.columns:
            p[c] = 0.0
    p["partidistas"] = p[FAMILIA_IDS].sum(axis=1)
    p["validos"] = p["partidistas"] + p["blanco"]
    p["votantes"] = p["validos"] + p["nulo"] + p["no_marcado"]
    return p


# ───────────────────────── análisis ─────────────────────────

def resumen_ciudad(cat, listas, censos) -> dict:
    out = {}
    for anio in C.YEARS:
        p = pivot_categorias(cat[cat["eleccion"] == f"concejo_{anio}"].assign(k=1), ["k"]).iloc[0]
        L = listas[listas["anio"] == anio].set_index("lista_id")
        curules = (L["curules_repartidora"] + L["curul_oposicion"]).to_dict()
        votos = L["votos"].to_dict()
        op = C.CURULES_OFICIALES[anio]["oposicion"]
        if op not in curules:
            curules[op], votos[op] = 1, 0
        potencial = int(censos[anio]["potencial"].sum())
        out[str(anio)] = {
            "potencial": potencial, "votantes": int(p["votantes"]), "participacion": float(p["votantes"] / potencial),
            "validos": int(p["validos"]), "votos_listas": int(p["partidistas"]),
            "blanco": int(p["blanco"]), "nulo": int(p["nulo"]), "no_marcado": int(p["no_marcado"]),
            "pct_blanco": float(p["blanco"] / p["validos"]), "pct_nulo": float(p["nulo"] / p["votantes"]),
            "pct_no_marcado": float(p["no_marcado"] / p["votantes"]),
            "nep_votos": nep(v for v in votos.values() if v > 0), "nep_curules": nep(curules.values()),
            "gallagher": gallagher(votos, curules), "listas_inscritas": int(len(L)),
            "listas_con_curul": int(sum(1 for v in curules.values() if v > 0)),
            "listas_sobre_umbral": int(L["supera_umbral"].sum()),
            "familias_pct_validos": {f: float(p[f] / p["validos"]) for f in FAMILIA_IDS},
            "voto_preferente_pct": float(L["votos_candidato"].sum() / L["votos"].sum()),
        }
    f19 = {f: out["2019"]["familias_pct_validos"][f] for f in FAMILIA_IDS}
    f23 = {f: out["2023"]["familias_pct_validos"][f] for f in FAMILIA_IDS}
    out["pedersen_familias_2019_2023"] = pedersen(f19, f23)
    l19 = listas[listas["anio"] == 2019].set_index("lista_id")["votos"].to_dict()
    l23 = listas[listas["anio"] == 2023].set_index("lista_id")["votos"].to_dict()
    out["pedersen_listas_2019_2023"] = pedersen(l19, l23)
    return out


def por_unidad(cat, censos, geo, nivel: str) -> pd.DataFrame:
    """Participación, blanco y cuotas por familia para cada elección y unidad (localidad_cod | upz_cod)."""
    base = cat[~cat["localidad_cod"].isin(C.ESPECIALES)].copy()
    p = pivot_categorias(base, ["eleccion", nivel]).reset_index()
    for f in FAMILIA_IDS + ["blanco"]:
        p[f"pct_{f}"] = p[f] / p["validos"].where(p["validos"] > 0)
    p["ganador"] = p[[f"pct_{f}" for f in FAMILIA_IDS]].idxmax(axis=1).str[4:]
    srt = np.sort(p[[f"pct_{f}" for f in FAMILIA_IDS]].fillna(0).values, axis=1)
    p["margen"] = srt[:, -1] - srt[:, -2]
    # potencial electoral (solo años con censo por puesto)
    pots = []
    for anio in C.YEARS:
        c = censos[anio].merge(geo[geo["eleccion"] == f"concejo_{anio}"][["puesto_id", "upz_cod", "localidad_cod"]],
                               on="puesto_id", how="left")
        g = c.groupby(nivel)["potencial"].sum().reset_index()
        g["eleccion"] = f"concejo_{anio}"
        pots.append(g)
    p = p.merge(pd.concat(pots), on=["eleccion", nivel], how="left")
    p["participacion"] = p["votantes"] / p["potencial"]
    return p


def volatilidad_localidades(loc: pd.DataFrame) -> dict:
    out = {}
    a = loc[loc["eleccion"] == "concejo_2019"].set_index("localidad_cod")
    b = loc[loc["eleccion"] == "concejo_2023"].set_index("localidad_cod")
    for cod in a.index.intersection(b.index):
        out[int(cod)] = pedersen({f: a.at[cod, f] for f in FAMILIA_IDS}, {f: b.at[cod, f] for f in FAMILIA_IDS})
    return out


def lisa_upz(upz_df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    from esda.moran import Moran, Moran_Local
    from libpysal.weights import Queen

    poly = gpd.read_file(C.UPZ_GEOJSON)
    if poly.crs is None:
        poly = poly.set_crs(4326)
    d23 = upz_df[upz_df["eleccion"] == "concejo_2023"].set_index("upz_cod")
    d19 = upz_df[upz_df["eleccion"] == "concejo_2019"].set_index("upz_cod")
    poly = poly[poly["UPLCODIGO"].isin(d23.index)].reset_index(drop=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        w = Queen.from_dataframe(poly, use_index=False)
    w.transform = "r"
    etiquetas = {1: "alto-alto", 2: "bajo-alto", 3: "bajo-bajo", 4: "alto-bajo"}
    filas, globales = [], {}
    variables = {f"pct_{f}": f for f in FAMILIA_IDS} | {"participacion": "participacion", "pct_blanco": "blanco"}
    for col, nombre in variables.items():
        y = d23.loc[poly["UPLCODIGO"], col].fillna(0).values
        if np.nanstd(y) == 0:
            continue
        mg = Moran(y, w, permutations=999)
        ml = Moran_Local(y, w, permutations=999, seed=C.SEED)
        globales[nombre] = {"I": float(mg.I), "p": float(mg.p_sim)}
        for cod, q, psim in zip(poly["UPLCODIGO"], ml.q, ml.p_sim):
            filas.append({"upz_cod": cod, "variable": nombre, "cluster": etiquetas[int(q)] if psim < 0.05 else "no_significativo",
                          "p": float(psim)})
        if nombre in FAMILIA_IDS:
            sw = (d23.loc[poly["UPLCODIGO"], col] - d19.reindex(poly["UPLCODIGO"])[col]).fillna(0).values
            if np.nanstd(sw) > 0:
                globales[f"swing_{nombre}"] = {"I": float(Moran(sw, w, permutations=999).I)}
    return pd.DataFrame(filas), globales


def candidatos(geo: pd.DataFrame, listas: pd.DataFrame) -> pd.DataFrame:
    cp = pd.read_parquet(C.PROCESSED / "concejo_candidatos_puesto.parquet")
    cp = cp.merge(geo[["eleccion", "puesto_id", "upz_cod", "localidad_cod"]].assign(anio=lambda d: d["eleccion"].str[-4:].astype(int)),
                  on=["anio", "puesto_id"], how="left")
    filas = []
    for (anio, lista, cod), g in cp.groupby(["anio", "lista_id", "candidato_cod"]):
        tot = g["votos"].sum()
        por_loc = g.groupby("localidad_cod")["votos"].sum().sort_values(ascending=False)
        loc_vec = por_loc.reindex(range(1, 21), fill_value=0)
        filas.append({
            "anio": int(anio), "lista_id": lista, "familia_id": g["familia_id"].iat[0], "candidato_cod": cod,
            "nombre": g["candidato_display"].iat[0], "clave": text_key(g["candidato_nombre"].iat[0]), "votos": int(tot),
            "localidad_fuerte": int(por_loc.index[0]) if tot else None,
            "pct_localidad_fuerte": float(por_loc.iat[0] / tot) if tot else 0.0,
            "gini_puestos": gini(g.groupby("puesto_id")["votos"].sum().reindex(geo.loc[geo["eleccion"] == f"concejo_{anio}", "puesto_id"], fill_value=0)),
            "vector_localidades": (loc_vec / tot).round(4).tolist() if tot else [0.0] * 20,
        })
    df = pd.DataFrame(filas)
    df["rank_lista"] = df.groupby(["anio", "lista_id"])["votos"].rank(ascending=False, method="first").astype(int)
    cur = listas.set_index(["anio", "lista_id"])["curules_repartidora"]
    df["curules_lista"] = [int(cur.get((a, l), 0)) for a, l in zip(df["anio"], df["lista_id"])]
    df["elegido"] = df["rank_lista"] <= df["curules_lista"]
    tot_lista = df.groupby(["anio", "lista_id"])["votos"].transform("sum")
    df["pct_de_lista"] = df["votos"] / tot_lista
    # trayectorias 2019 -> 2023 (misma persona: nombre normalizado sin tildes)
    a, b = df[df["anio"] == 2019].set_index("clave"), df[df["anio"] == 2023].set_index("clave")
    comunes = a.index.intersection(b.index)
    df["compitio_ambos"] = df["clave"].isin(comunes)
    sim = {}
    for k in comunes:
        va, vb = np.array(a.at[k, "vector_localidades"]), np.array(b.at[k, "vector_localidades"])
        sim[k] = float(va.dot(vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-12))
    df["similitud_territorial"] = df["clave"].map(sim)
    return df


def demografia(cat: pd.DataFrame, censos: dict) -> dict:
    """Relación ecológica (por puesto) entre estructura etaria/sexo y cuota de cada familia en 2023."""
    base = cat[(cat["eleccion"] == "concejo_2023") & ~cat["localidad_cod"].isin(C.ESPECIALES)]
    p = pivot_categorias(base, ["puesto_id"]).reset_index()
    c = censos[2023].copy()
    c["jovenes_18_30"] = (c["e18_20"] + c["e21_25"] + c["e26_30"]) / c["potencial"]
    c["mayores_60"] = c["e60_mas"] / c["potencial"]
    c["mujeres"] = c["mujeres"] / c["potencial"]
    d = p.merge(c[["puesto_id", "potencial", "jovenes_18_30", "mayores_60", "mujeres"]], on="puesto_id")
    d = d[(d["validos"] >= 300) & (d["potencial"] > 0)]
    d["participacion"] = d["votantes"] / d["potencial"]
    X_cols = ["jovenes_18_30", "mayores_60", "mujeres"]
    Z = (d[X_cols] - d[X_cols].mean()) / d[X_cols].std()
    X = np.column_stack([np.ones(len(d)), Z.values])
    res = {"n_puestos": int(len(d)), "variables": X_cols, "modelos": {}, "puntos": []}
    for f in FAMILIA_IDS + ["blanco", "participacion"]:
        y = (d["participacion"] if f == "participacion" else d[f] / d["validos"]).values
        beta, ee, r2 = ols_robusto(X, y, d["validos"].values)
        res["modelos"][f] = {"r2": r2, "coef": {v: {"b": float(beta[i + 1]), "ee": float(ee[i + 1])} for i, v in enumerate(X_cols)},
                             "intercepto": float(beta[0])}
    for r in d.itertuples():
        res["puntos"].append({"id": r.puesto_id, "j": round(r.jovenes_18_30, 4), "m60": round(r.mayores_60, 4),
                              "part": round(r.participacion, 4),
                              **{f: round(getattr(r, f) / r.validos, 4) for f in FAMILIA_IDS}})
    return res


def main() -> None:
    cat, geo, listas, censos = cargar()
    resultado = {"ciudad": resumen_ciudad(cat, listas, censos)}
    loc = por_unidad(cat, censos, geo, "localidad_cod")
    upz = por_unidad(cat[cat["upz_cod"].notna()], censos, geo, "upz_cod")
    loc.to_parquet(C.PROCESSED / "indicadores_localidad.parquet", index=False)
    upz.to_parquet(C.PROCESSED / "indicadores_upz.parquet", index=False)
    resultado["volatilidad_localidad"] = volatilidad_localidades(loc)
    lisa, moran = lisa_upz(upz)
    lisa.to_parquet(C.PROCESSED / "lisa_upz.parquet", index=False)
    resultado["moran_global"] = moran
    cands = candidatos(geo, listas)
    cands.to_parquet(C.PROCESSED / "candidatos.parquet", index=False)
    resultado["demografia"] = demografia(cat, censos)
    (C.PROCESSED / "analisis.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=1, default=float),
                                              encoding="utf-8")
    c = resultado["ciudad"]
    print(f"Participación 2019 {c['2019']['participacion']:.1%} · 2023 {c['2023']['participacion']:.1%} · "
          f"Pedersen familias {c['pedersen_familias_2019_2023']:.3f} · NEP votos 2023 {c['2023']['nep_votos']:.2f}")
    print("Moran I:", {k: round(v["I"], 2) for k, v in moran.items() if not k.startswith("swing")})


if __name__ == "__main__":
    main()
