"""Fase 5 — Pronóstico probabilístico del Concejo de Bogotá 2027 con backtest fuera de muestra sobre 2023.

Diseño (escala logit de la cuota de votos válidos, por familia política + voto en blanco):

1. Centro. Se comparan tres reglas con información disponible antes de 2023 y se elige la de menor error real
   sobre 2023 (MAE en puntos): (a) persistencia —repetir el último Concejo—; (b) swing uniforme de la Cámara;
   (c) transferencia logit del cambio en Cámara con coeficiente κ estimado dejando una familia fuera.
2. Incertidumbre. Los cambios logit entre Concejos (2011→2015→2019→2023) tienen colas pesadas (choques como el del
   Nuevo Liberalismo en 2023), así que se modelan con una t de Student de media cero cuyos grados de libertad y
   escala se estiman por máxima verosimilitud.
3. Movimientos sin historial en el Concejo (La Lista de Oviedo) se proyectan desde su votación a Cámara 2026 con la
   tasa de conversión Cámara→Concejo observada entre partidos (log-normal: mediana y dispersión).
4. Monte Carlo: cuotas → reparto dentro de cada familia (Dirichlet) → umbral + cifra repartidora de 44 curules.

Uso: ``python -m pipeline.model``
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy import stats

from . import config as C
from .partidos import FAMILIA_IDS, LISTAS_INFO
from .seats import cifra_repartidora_lote

CATS = FAMILIA_IDS + ["blanco"]
IDX = {c: i for i, c in enumerate(CATS)}
ESTABLECIDA = 0.015
EPS = 0.002
ALFA_DIRICHLET = 25.0
N_MUESTRA_WEB = 2_000
NOMBRES_REGLA = {"persistencia": "Persistencia (repetir el último Concejo)",
                 "swing_uniforme": "Swing uniforme de Cámara",
                 "transferencia": "Transferencia logit desde Cámara (κ)",
                 "transferencia_matriz": "Matriz de transferencia (inferencia ecológica bayesiana)",
                 "transferencia_presidencial": "Transferencia logit desde Presidencial (κ)"}
rng = np.random.default_rng(C.SEED)


def logit(p):
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def inv_logit(x):
    return 1.0 / (1.0 + np.exp(-x))


def normalizar(P):
    P = np.clip(np.asarray(P, dtype=float), 0, None)
    return P / P.sum(axis=-1, keepdims=True)


def q(x, p):
    return float(np.quantile(x, p))


# ───────────────────────── datos ─────────────────────────

def tabla_cuotas() -> pd.DataFrame:
    ciudad = pd.read_csv(C.PROCESSED / "ciudad_categoria.csv")
    filas = {}
    for el, g in ciudad.groupby("eleccion"):
        filas[el] = g.set_index("categoria")["votos"].reindex(CATS).fillna(0.0)
    hist = pd.read_csv(C.REFERENCE / "concejo_historico.csv")
    for anio, g in hist.groupby("anio"):
        filas[f"concejo_{anio}"] = g.groupby("familia_id")["votos"].sum().reindex(CATS).fillna(0.0)
    V = pd.DataFrame(filas).T
    return V.div(V.sum(axis=1), axis=0)


# ───────────────────────── calibración ─────────────────────────

def calibrar_volatilidad(S: pd.DataFrame, transiciones: list[tuple[int, int]]) -> dict:
    cambios, emergencias = [], []
    for a, b in transiciones:
        sa, sb = S.loc[f"concejo_{a}"], S.loc[f"concejo_{b}"]
        for c in CATS:
            if sa[c] >= ESTABLECIDA and sb[c] >= ESTABLECIDA:
                cambios.append({"de": a, "a": b, "categoria": c, "cuota_de": float(sa[c]), "cuota_a": float(sb[c]),
                                "cambio_logit": float(logit(sb[c]) - logit(sa[c]))})
            elif sa[c] < ESTABLECIDA <= sb[c]:
                emergencias.append({"de": a, "a": b, "categoria": c, "cuota": float(sb[c])})
    x = np.array([d["cambio_logit"] for d in cambios])
    nu, _, escala = stats.t.fit(x, floc=0)
    if not 2.5 <= nu <= 30:
        nu = float(np.clip(nu, 2.5, 30))
        _, _, escala = stats.t.fit(x, fdf=nu, floc=0)
    return {"sigma": float(np.sqrt(np.mean(x ** 2))), "sigma_robusta": float(1.4826 * np.median(np.abs(x - np.median(x)))),
            "nu": float(nu), "escala_t": float(escala), "n": int(len(x)), "cambios": cambios, "emergencias": emergencias}


def calibrar_kappa(S: pd.DataFrame, leg0: str, leg1: str, base: str, obj: str) -> dict:
    ok = [c for c in CATS if min(S.loc[e, c] for e in (leg0, leg1, base, obj)) >= ESTABLECIDA]
    x = logit(S.loc[leg1, ok]) - logit(S.loc[leg0, ok])
    y = logit(S.loc[obj, ok]) - logit(S.loc[base, ok])
    filas, ek, e0 = [], [], []
    for i, c in enumerate(ok):
        m = np.arange(len(ok)) != i
        k_i = float(x[m] @ y[m] / (x[m] @ x[m]))
        ek.append(y[i] - k_i * x[i])
        e0.append(y[i])
        filas.append({"categoria": c, "cambio_camara": float(x[i]), "cambio_concejo": float(y[i]), "kappa_sin_ella": k_i})
    return {"kappa_mco": float(x @ y / (x @ x)), "rmse_cv_logit_con_kappa": float(np.sqrt(np.mean(np.square(ek)))),
            "rmse_cv_logit_persistencia": float(np.sqrt(np.mean(np.square(e0)))),
            "correlacion": float(np.corrcoef(x, y)[0, 1]), "familias": filas}


def conversion_camara_concejo(S: pd.DataFrame, camara: str, concejo: str) -> dict:
    ok = [c for c in FAMILIA_IDS if S.loc[camara, c] >= ESTABLECIDA and S.loc[concejo, c] >= ESTABLECIDA and c != "otros"]
    r = S.loc[concejo, ok] / S.loc[camara, ok]
    lr = np.log(r.values.astype(float))
    return {"mediana": float(np.exp(np.median(lr))), "mu_log": float(np.median(lr)), "sd_log": float(np.std(lr, ddof=1)),
            "por_familia": {c: float(v) for c, v in r.items()}}


def cargar_matriz_transferencia(nombre: str) -> tuple[np.ndarray | None, dict | None]:
    """Carga la media posterior de la matriz de `pipeline.transferencia`, si ya se calculó.

    Es una capa opcional del motor: si el archivo o el par todavía no existen (no se ha corrido
    `python -m pipeline.transferencia`, que es lento), se omite la regla en vez de romper el resto
    del pronóstico — la matriz solo debe entrar en producción cuando además gana el backtest.
    """
    path = C.PROCESSED / "transferencia.json"
    if not path.exists():
        return None, None
    par = json.loads(path.read_text(encoding="utf-8")).get(nombre)
    if par is None:
        return None, None
    T = np.array(par["media"])
    if par["categorias"] != CATS:
        idx = [par["categorias"].index(c) for c in CATS]
        T = T[np.ix_(idx, idx)]
    return T, par


def centro_matriz(s: np.ndarray, T: np.ndarray) -> np.ndarray:
    """Regla de centro por matriz de transferencia: nueva cuota = s @ T (fila origen -> columna destino)."""
    return logit(normalizar(s @ T))


def centros(S: pd.DataFrame, base: str, leg0: str, leg1: str, kappa: dict, matriz: np.ndarray | None = None,
            leg0_pres: str | None = None, leg1_pres: str | None = None, kappa_pres: dict | None = None) -> dict[str, np.ndarray]:
    s, c0, c1 = (S.loc[e, CATS].values.astype(float) for e in (base, leg0, leg1))
    elegibles = np.array([min(S.loc[leg0, c], S.loc[leg1, c], S.loc[base, c]) >= ESTABLECIDA for c in CATS])
    lofo = {f["categoria"]: f["kappa_sin_ella"] for f in kappa["familias"]}
    k = np.array([np.clip(lofo.get(c, kappa["kappa_mco"]), 0, 1) if elegibles[i] else 0.0 for i, c in enumerate(CATS)])
    out = {"persistencia": logit(s),
           "swing_uniforme": logit(normalizar(np.clip(s + (c1 - c0), 0, None))),
           "transferencia": logit(s) + k * (logit(c1) - logit(c0))}
    if matriz is not None:
        out["transferencia_matriz"] = centro_matriz(s, matriz)
    if kappa_pres is not None:
        # mismo mecanismo que `transferencia` (κ + leave-one-out + clip[0,1]), pero calibrado con la
        # presidencial en vez de con Cámara — ver nota en pipeline/model.py sobre por qué NO se debe
        # relajar el clip aunque el κ presidencial salga negativo con los datos actuales.
        c0p, c1p = (S.loc[e, CATS].values.astype(float) for e in (leg0_pres, leg1_pres))
        elegibles_p = np.array([min(S.loc[leg0_pres, c], S.loc[leg1_pres, c], S.loc[base, c]) >= ESTABLECIDA for c in CATS])
        lofo_p = {f["categoria"]: f["kappa_sin_ella"] for f in kappa_pres["familias"]}
        k_p = np.array([np.clip(lofo_p.get(c, kappa_pres["kappa_mco"]), 0, 1) if elegibles_p[i] else 0.0 for i, c in enumerate(CATS)])
        out["transferencia_presidencial"] = logit(s) + k_p * (logit(c1p) - logit(c0p))
    return out


# ───────────────────────── simulación ─────────────────────────

TOPE_EMERGENTES = 0.7  # ninguna combinación de listas emergentes puede acaparar más del 70% de la ciudad


def simular(mu: np.ndarray, ruido: tuple[float, float], estructura: list[dict], n: int, emergentes: list[dict] | None = None,
            dirichlet: bool = True):
    """Devuelve (cuotas por categoría (n, cats), cuotas por lista (n, L), curules (n, L), ids de lista).

    ``ruido`` = (grados de libertad, escala) de la t de Student en escala logit. Listas + blanco suman 1.

    ``emergentes``: listas sin historial en el Concejo (cada una: id, cuota_base, mu_log, sd_log, y
    opcionalmente ``desde``: un peso por familia de origen). Cada una reparte log-normal alrededor de su
    cuota base. Sin ``desde`` se resta proporcionalmente de toda la ciudad (el comportamiento original,
    pensado para una lista nueva sin narrativa de origen, como la Lista de Oviedo); con ``desde`` se resta
    de las familias indicadas —p. ej. un partido que se narra como una escisión de una familia concreta—.
    Con más de una emergente la suma se topa a ``TOPE_EMERGENTES`` y se reescala en conjunto, y la resta se
    recalcula sobre la ciudad ANTES de restar ninguna (no de forma secuencial), para que la masa total siga
    sumando 1 exacto pase lo que pase con los topes o con los clips de categorías que se queden en cero.
    """
    nu, escala = ruido
    eps = rng.standard_t(nu, (n, len(CATS))) * escala if escala > 0 else 0.0
    P = normalizar(inv_logit(mu[None, :] + eps))
    es: dict[str, np.ndarray] = {}
    if emergentes:
        crudo = {em["id"]: np.clip(np.exp(rng.normal(em["mu_log"], em["sd_log"], n)) * em["cuota_base"], 0, 0.35)
                 for em in emergentes}
        suma_cruda = sum(crudo.values())
        factor = np.minimum(1.0, TOPE_EMERGENTES / np.maximum(suma_cruda, 1e-9))
        es = {k: v * factor for k, v in crudo.items()}
        resta = np.zeros_like(P)
        for em in emergentes:
            e = es[em["id"]]
            if em.get("desde"):
                w = np.zeros(len(CATS))
                for fam, peso in em["desde"].items():
                    w[IDX[fam]] = peso
                w = w / w.sum()
                resta += e[:, None] * w[None, :]
            else:
                resta += e[:, None] * P  # proporcional al tamaño actual de cada categoría
        total_e = sum(es.values())
        P = np.clip(P - resta, 0, None)
        P = P / P.sum(axis=1, keepdims=True) * (1 - total_e)[:, None]  # exacto: el resto suma 1 - Σe
    ids, cuotas = [], []
    for fam in FAMILIA_IDS:
        ls = [l for l in estructura if l["familia"] == fam]
        if not ls:
            continue
        w0 = np.array([l["peso"] for l in ls], dtype=float)
        w0 = w0 / w0.sum()
        W = rng.dirichlet(ALFA_DIRICHLET * w0 + 1e-3, n) if (len(ls) > 1 and dirichlet) else np.tile(w0, (n, 1))
        for j, l in enumerate(ls):
            ids.append(l["id"])
            cuotas.append(P[:, IDX[fam]] * W[:, j])
    for eid, e in es.items():
        ids.append(eid)
        cuotas.append(e)
    L = np.column_stack(cuotas)
    curules = cifra_repartidora_lote(L * 1e6, P[:, IDX["blanco"]] * 1e6)
    return P, L, curules, ids


def _familia_de(i: str, familia_extra: dict[str, str] | None = None) -> str:
    """Familia de una lista para agregarla en la UI. ``familia_extra`` cubre listas emergentes de un
    escenario que no están en `LISTAS_INFO` (partidos reales) por no existir todavía — p. ej. un partido
    nuevo hipotético. Sin declarar, se cuentan en "otros", la misma convención que ya usa el motor para
    movimientos independientes sin historial (ver `con_toda_por_bogota` en partidos.py).
    """
    return LISTAS_INFO[i][1] if i in LISTAS_INFO else (familia_extra or {}).get(i, "otros")


def curules_por_familia(cur: np.ndarray, ids: list[str], familia_extra: dict[str, str] | None = None) -> np.ndarray:
    return np.column_stack([cur[:, [j for j, i in enumerate(ids) if _familia_de(i, familia_extra) == f]].sum(axis=1)
                            if any(_familia_de(i, familia_extra) == f for i in ids) else np.zeros(len(cur), dtype=int)
                            for f in FAMILIA_IDS])


def resumen_distribucion(x: np.ndarray) -> dict:
    return {"media": float(np.mean(x)), "p50": q(x, 0.5), "p10": q(x, 0.1), "p90": q(x, 0.9),
            "p025": q(x, 0.025), "p975": q(x, 0.975)}


def resumen_curules(c: np.ndarray, maximo: int = C.CURULES_REPARTIDORA) -> dict:
    hist = np.bincount(np.asarray(c, dtype=int), minlength=maximo + 1)[: maximo + 1] / len(c)
    return {**resumen_distribucion(c), "p_cero": float((np.asarray(c) == 0).mean()), "hist": [round(float(h), 4) for h in hist]}


# ───────────────────────── backtest 2023 ─────────────────────────

def backtest(S: pd.DataFrame, listas: pd.DataFrame, n: int) -> dict:
    vol = calibrar_volatilidad(S, [(2011, 2015), (2015, 2019)])  # solo transiciones previas a 2023
    kap = calibrar_kappa(S, "camara_2018", "camara_2022", "concejo_2019", "concejo_2023")
    # presidencial 2018→2022 (jun 2018, jun 2022) es anterior a concejo_2023 (oct 2023) — mismo
    # criterio leak-free que ya usa camara_2018_2022 justo abajo. Opcional (`None` si algún día se
    # regenera S sin presidenciales): centros() ignora la regla si kappa_pres es None.
    kap_pres = (calibrar_kappa(S, "presidente_2018", "presidente_2022", "concejo_2019", "concejo_2023")
               if {"presidente_2018", "presidente_2022"} <= set(S.index) else None)
    real = S.loc["concejo_2023", CATS].values.astype(float)
    # OJO: la matriz concejo_2019_2023 NO puede usarse aquí — se estimó CON el resultado real de
    # 2023, así que "predecir" con ella sería circular (igual que sería circular si `kap` no usara
    # leave-one-out). Para competir limpio contra las otras tres reglas, que solo usan información
    # anterior a 2023, se usa la matriz Cámara 2018→2022: el mismo par pre-2023 que ya usa `kap`.
    T_bt, _ = cargar_matriz_transferencia("camara_2018_2022")
    reglas = centros(S, "concejo_2019", "camara_2018", "camara_2022", kap, matriz=T_bt,
                     leg0_pres="presidente_2018", leg1_pres="presidente_2022", kappa_pres=kap_pres)

    # listas inscritas en 2023; peso dentro de la familia según 2019 (listas nuevas: promedio de su familia o igualitario)
    L23 = listas[listas["anio"] == 2023]
    hist19 = listas[listas["anio"] == 2019].set_index("lista_id")["votos"]
    estructura = [{"id": r.lista_id, "familia": r.familia_id, "peso": float(hist19.get(r.lista_id, np.nan))}
                  for r in L23.itertuples()]
    for fam in FAMILIA_IDS:
        ls = [e for e in estructura if e["familia"] == fam]
        conocidos = [e["peso"] for e in ls if not np.isnan(e["peso"])]
        for e in ls:
            if np.isnan(e["peso"]):
                e["peso"] = float(np.mean(conocidos)) if conocidos else 1.0
    fam_real = L23.groupby("familia_id")["curules_repartidora"].sum().reindex(FAMILIA_IDS).fillna(0).values

    metricas = {}
    for clave, mu_c in reglas.items():
        p = normalizar(inv_logit(mu_c))
        err = (p - real) * 100
        _, _, cur, ids = simular(logit(p), (5.0, 0.0), estructura, 1, dirichlet=False)
        fam_pred = curules_por_familia(cur, ids)[0]
        metricas[clave] = {"nombre": NOMBRES_REGLA[clave], "mae_pp": float(np.mean(np.abs(err))),
                           "rmse_pp": float(np.sqrt(np.mean(err ** 2))),
                           "error_curules_familias": int(np.abs(fam_pred - fam_real).sum()),
                           "cuotas": {c: float(v) for c, v in zip(CATS, p)},
                           "curules_familias": {f: int(v) for f, v in zip(FAMILIA_IDS, fam_pred)}}
    elegido = min(metricas, key=lambda k: (round(metricas[k]["mae_pp"], 2), metricas[k]["error_curules_familias"]))

    P, Lc, cur, ids = simular(reglas[elegido], (vol["nu"], vol["escala_t"]), estructura, n)
    F = curules_por_familia(cur, ids)
    fam_det = []
    for k, f in enumerate(FAMILIA_IDS):
        s = F[:, k]
        fam_det.append({"familia": f, "real_cuota": float(real[IDX[f]]), "real_curules": int(fam_real[k]),
                        "cuota": resumen_distribucion(P[:, IDX[f]]), "curules": resumen_curules(s),
                        "cuota_dentro_80": bool(q(P[:, IDX[f]], 0.1) <= real[IDX[f]] <= q(P[:, IDX[f]], 0.9)),
                        "dentro_80": bool(q(s, 0.1) <= fam_real[k] <= q(s, 0.9)),
                        "dentro_95": bool(q(s, 0.025) <= fam_real[k] <= q(s, 0.975))})
    cob80 = [q(P[:, i], 0.1) <= real[i] <= q(P[:, i], 0.9) for i in range(len(CATS))]
    cob95 = [q(P[:, i], 0.025) <= real[i] <= q(P[:, i], 0.975) for i in range(len(CATS))]
    return {"volatilidad_previa": {k: v for k, v in vol.items() if k != "cambios"}, "kappa": kap, "metricas": metricas,
            "elegido": elegido, "cobertura_cuotas_80": float(np.mean(cob80)), "cobertura_cuotas_95": float(np.mean(cob95)),
            "cobertura_curules_80": float(np.mean([d["dentro_80"] for d in fam_det])),
            "cobertura_curules_95": float(np.mean([d["dentro_95"] for d in fam_det])), "familias": fam_det,
            "matriz_usada": "camara_2018_2022" if T_bt is not None else None}


# ───────────────────────── pronóstico 2027 ─────────────────────────

def cuota_lista(eleccion: str, partido_cod: str) -> float:
    cat = pd.read_parquet(C.PROCESSED / "votos_puesto_categoria.parquet", columns=["eleccion", "categoria", "votos"])
    validos = cat[(cat["eleccion"] == eleccion) & cat["categoria"].isin(CATS)]["votos"].sum()
    xw = pd.read_csv(C.REFERENCE / "partidos_crosswalk.csv", dtype={"partido_cod": str})
    fila = xw[(xw["eleccion"] == eleccion) & (xw["partido_cod"].str.zfill(5) == partido_cod.zfill(5))]
    return float(fila["votos_lista"].iat[0] / validos)


def pronostico(S: pd.DataFrame, listas: pd.DataFrame, n: int, elegido: str) -> dict:
    vol = calibrar_volatilidad(S, [(2011, 2015), (2015, 2019), (2019, 2023)])
    kap = calibrar_kappa(S, "camara_2018", "camara_2022", "concejo_2019", "concejo_2023")
    kap_pres = (calibrar_kappa(S, "presidente_2018", "presidente_2022", "concejo_2019", "concejo_2023")
               if {"presidente_2018", "presidente_2022"} <= set(S.index) else None)
    conv = conversion_camara_concejo(S, "camara_2022", "concejo_2023")
    kap_2027 = {**kap, "familias": []}  # para 2027 se aplica el κ de MCO a toda familia elegible
    kap_pres_2027 = {**kap_pres, "familias": []} if kap_pres is not None else None
    # el pronóstico usa la matriz Cámara 2022→2026 (no hay una que termine en 2027): mismo supuesto
    # que ya hace la regla `transferencia` de κ, que también traslada el cambio observado en Cámara.
    # Presidencial 2022→2026 (jun 2022, jun 2026) es la contraparte presidencial: ambas anteriores a
    # concejo_2027 (oct 2027), sin fuga de datos.
    T_fc, _ = cargar_matriz_transferencia("camara_2022_2026")
    reglas = centros(S, "concejo_2023", "camara_2022", "camara_2026", kap_2027, matriz=T_fc,
                     leg0_pres="presidente_2022", leg1_pres="presidente_2026", kappa_pres=kap_pres_2027)
    ruido = (vol["nu"], vol["escala_t"])
    s23 = S.loc["concejo_2023", CATS].values.astype(float)

    L23 = listas[listas["anio"] == 2023]
    estructura = [{"id": r.lista_id, "familia": r.familia_id, "peso": float(r.votos)} for r in L23.itertuples()]
    emergente = {"id": "con_toda_por_bogota", "cuota_base": cuota_lista("camara_2026", "01044"),
                 "mu_log": conv["mu_log"], "sd_log": conv["sd_log"]}

    P, Lc, cur, ids = simular(reglas[elegido], ruido, estructura, n, [emergente])
    F = curules_por_familia(cur, ids)
    cuota_fam = np.column_stack([Lc[:, [j for j, i in enumerate(ids) if _familia_de(i) == f]].sum(axis=1) for f in FAMILIA_IDS])
    mayor = F.argmax(axis=1)
    empate = (F == F.max(axis=1, keepdims=True)).sum(axis=1) > 1

    umbral_rel = C.UMBRAL_FRACCION_COCIENTE / C.CURULES_REPARTIDORA
    cur23 = L23.set_index("lista_id")["curules_repartidora"]
    listas_out = [{"id": i, "nombre": LISTAS_INFO[i][0], "familia": LISTAS_INFO[i][1], "cuota": resumen_distribucion(Lc[:, j]),
                   "curules": resumen_curules(cur[:, j]), "p_umbral": float((Lc[:, j] >= umbral_rel).mean()),
                   "curules_2023": int(cur23.get(i, 0))} for j, i in enumerate(ids)]
    fam23 = L23.groupby("familia_id")["curules_repartidora"].sum()
    c26 = S.loc["camara_2026", CATS]
    fam_out = [{"id": f, "cuota": resumen_distribucion(cuota_fam[:, k]), "curules": resumen_curules(F[:, k]),
                "p_mayor_bancada": float(((mayor == k) & ~empate).mean()), "cuota_2023": float(s23[IDX[f]]),
                "curules_2023": int(fam23.get(f, 0)), "cuota_camara_2026": float(c26[f])} for k, f in enumerate(FAMILIA_IDS)]

    escenarios = {}
    variantes = {clave: (mu_r, [emergente]) for clave, mu_r in reglas.items() if clave != elegido}
    variantes["sin_lista_de_oviedo"] = (reglas[elegido], None)
    for clave, (mu_r, emerg) in variantes.items():
        _, _, ce, ide = simular(mu_r, ruido, estructura, n // 2, emerg)
        Fe = curules_por_familia(ce, ide)
        escenarios[clave] = {f: resumen_distribucion(Fe[:, k]) for k, f in enumerate(FAMILIA_IDS)}

    muestra = rng.choice(n, size=min(N_MUESTRA_WEB, n), replace=False)
    return {"regla_central": elegido, "nombre_regla": NOMBRES_REGLA[elegido], "volatilidad": vol, "kappa": kap,
            "conversion_camara_concejo": conv, "emergente": emergente,
            "centro_cuotas": {c: float(v) for c, v in zip(CATS, normalizar(inv_logit(reglas[elegido])))},
            "familias": fam_out, "listas": listas_out, "escenarios": escenarios,
            "blanco": resumen_distribucion(P[:, IDX["blanco"]]),
            "matriz_usada": "camara_2022_2026" if T_fc is not None else None,
            "muestra": {"listas": ids, "curules": cur[muestra].astype(int).tolist()}}


def participacion_2027() -> dict:
    censo = {a: int(pd.read_parquet(C.INTERIM / f"censo_{a}.parquet")["potencial"].sum()) for a in C.YEARS}
    pot26 = int(pd.read_parquet(C.INTERIM / "externas" / "divipol_congreso_2026.parquet")["potencial"].sum())
    g = (censo[2023] / censo[2019]) ** (1 / 4) - 1
    pot27 = pot26 * (1 + g) ** (19 / 12)
    a = json.loads((C.PROCESSED / "analisis.json").read_text(encoding="utf-8"))["ciudad"]
    parts = [a[str(y)]["participacion"] for y in C.YEARS]
    frac_validos = float(np.mean([a[str(y)]["validos"] / a[str(y)]["votantes"] for y in C.YEARS]))
    sims = rng.normal(np.mean(parts), max(abs(parts[0] - parts[1]), 0.03), C.N_SIMULACIONES)
    votantes = pot27 * sims
    validos = votantes * frac_validos
    return {"potencial_2019": censo[2019], "potencial_2023": censo[2023], "potencial_2026": pot26,
            "crecimiento_anual": g, "potencial_2027": pot27, "participacion": resumen_distribucion(sims),
            "votantes": resumen_distribucion(votantes), "validos": resumen_distribucion(validos),
            "cociente_votos": resumen_distribucion(validos / C.CURULES_REPARTIDORA),
            "umbral_votos": resumen_distribucion(validos / C.CURULES_REPARTIDORA * C.UMBRAL_FRACCION_COCIENTE)}


def proyeccion_upz(S: pd.DataFrame, centro: dict) -> tuple[dict, float]:
    """Proyección territorial central: persistencia local con encogimiento β estimado 2019→2023."""
    upz = pd.read_parquet(C.PROCESSED / "indicadores_upz.parquet")
    cols = [f"pct_{f}" for f in FAMILIA_IDS] + ["pct_blanco"]
    a = upz[upz["eleccion"] == "concejo_2019"].set_index("upz_cod")[cols]
    b = upz[upz["eleccion"] == "concejo_2023"].set_index("upz_cod")[cols]
    comunes = a.index.intersection(b.index)
    xs, ys = [], []
    for i, c in enumerate(CATS):
        if S.loc["concejo_2019", c] < ESTABLECIDA or S.loc["concejo_2023", c] < ESTABLECIDA:
            continue
        xs.append(logit(a.loc[comunes, cols[i]].fillna(0)) - logit(S.loc["concejo_2019", c]))
        ys.append(logit(b.loc[comunes, cols[i]].fillna(0)) - logit(S.loc["concejo_2023", c]))
    x, y = np.concatenate(xs), np.concatenate(ys)
    beta = float(np.clip(x @ y / (x @ x), 0, 1))
    out = {}
    for cod in b.index:
        v = np.array([logit(centro[c]) + beta * (logit(float(b.at[cod, cols[i]] or 0)) - logit(S.loc["concejo_2023", c]))
                      for i, c in enumerate(CATS)])
        p = normalizar(inv_logit(v))
        out[cod] = {c: round(float(p[i]), 4) for i, c in enumerate(CATS)}
    return out, beta


def main() -> None:
    S = tabla_cuotas()
    listas = pd.read_csv(C.PROCESSED / "concejo_listas.csv")
    n = C.N_SIMULACIONES
    print("Backtest 2023…")
    bt = backtest(S, listas, n)
    for k, v in bt["metricas"].items():
        print(f"  {v['nombre']:44s} MAE {v['mae_pp']:.2f} pp · error curules {v['error_curules_familias']}")
    vp = bt["volatilidad_previa"]
    print(f"  → regla elegida: {bt['elegido']} · t(ν={vp['nu']:.1f}, escala={vp['escala_t']:.3f})")
    print(f"  cobertura cuotas 80%: {bt['cobertura_cuotas_80']:.0%} · curules 80%: {bt['cobertura_curules_80']:.0%} · 95%: {bt['cobertura_curules_95']:.0%}")
    print("Pronóstico 2027…")
    pr = pronostico(S, listas, n, bt["elegido"])
    upz, beta = proyeccion_upz(S, pr["centro_cuotas"])
    salida = {"generado": pd.Timestamp.now(tz="America/Bogota").isoformat(timespec="minutes"),
              "eleccion": C.ELECCION_2027, "n_simulaciones": n, "curules_repartidora": C.CURULES_REPARTIDORA,
              "cuotas_historicas": {e: {c: float(v) for c, v in S.loc[e].items()} for e in S.index},
              "backtest_2023": bt, "pronostico": pr, "participacion": participacion_2027(),
              "proyeccion_upz": {"beta_persistencia_local": beta, "upz": upz}}
    (C.PROCESSED / "modelo.json").write_text(json.dumps(salida, ensure_ascii=False, default=float), encoding="utf-8")
    v = pr["volatilidad"]
    print(f"  t(ν={v['nu']:.1f}, escala={v['escala_t']:.3f}) · κ MCO = {pr['kappa']['kappa_mco']:.2f} · β local = {beta:.2f}")
    for f in pr["familias"]:
        c = f["curules"]
        print(f"  {f['id']:20s} {c['p50']:4.0f} curules [{c['p10']:.0f}–{c['p90']:.0f}]  P(mayor)={f['p_mayor_bancada']:.0%}  (2023: {f['curules_2023']})")
    ov = next(l for l in pr["listas"] if l["id"] == "con_toda_por_bogota")
    print(f"  Con Toda por Bogotá  {ov['curules']['p50']:.0f} [{ov['curules']['p10']:.0f}–{ov['curules']['p90']:.0f}]")
    for k, e in pr["escenarios"].items():
        print(f"  escenario {k}: " + ", ".join(f"{f[:6]} {d['p50']:.0f}" for f, d in e.items()))


if __name__ == "__main__":
    main()
