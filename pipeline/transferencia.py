"""Fase 2 — Matriz de transferencia de votos entre familias, por regresión ecológica bayesiana.

Estima, dos veces de forma INDEPENDIENTE, una matriz de transición origen→destino entre las 10
categorías del motor (las 9 familias de `partidos.FAMILIA_IDS` + blanco):

  1. Concejo 2019 → Concejo 2023 (misma elección, la comparación más limpia)
  2. Cámara 2022 → Cámara 2026 (más reciente; capta el reacomodo que ya se ve en el Congreso)

El problema de fondo es de inferencia ecológica: nunca se observa a una persona votando por A en
la elección de origen y por B en la de destino — solo se observan, por puesto, el total de cada
categoría de origen y el total de cada categoría de destino (los márgenes de una tabla cruzada
I×J que nunca se ve). El modelo "RxC" completo (Rosen, Jiang, King y Tanner, 2001) resuelve esto
muestreando la tabla cruzada LATENTE de cada puesto sujeta a sus dos márgenes exactos, con un
algoritmo de aumento de datos hecho a medida. Aquí se usa una simplificación deliberada y más
liviana, que sigue siendo genuinamente bayesiana: en vez de una tabla latente por puesto, cada
puesto aporta un término de verosimilitud Dirichlet-Multinomial (Pólya) centrado en la MEZCLA
esperada de destino —la combinación de las filas de la matriz global ponderada por la composición
de origen de ese puesto— con una concentración `kappa` que absorbe cuánto se aparta cada puesto de
esa mezcla. Es la versión "de regresión ecológica" del problema en vez de la versión "de tabla
latente": no requiere variables discretas latentes (por lo que es compatible con NUTS) y con
~900 puestos por par de elecciones el número de parámetros libres es ~90-100, viable en un
servidor modesto. La matriz resultante SÍ tiene posterior completo (no un punto), y esa
incertidumbre es la que se propaga al Monte Carlo del pronóstico (ver `model.py`).

Límite honesto: como cualquier inferencia ecológica, la identificación depende de que la
composición de origen varíe lo suficiente entre puestos (si todos los puestos votaran igual en
2019/2022, ninguna cantidad de datos podría separar "todos se quedan" de "todos rotan en la misma
proporción"). Bogotá tiene bastante heterogeneidad geográfica de voto (la misma que ya usan LISA/
Moran en otras partes del pipeline), así que la matriz debería estar razonablemente identificada,
pero los intervalos de credibilidad —no solo la media posterior— son el resultado que hay que
mirar antes de confiar en una celda.

Uso: ``python -m pipeline.transferencia``
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pymc as pm

from . import config as C
from .partidos import FAMILIA_IDS

CATEGORIAS = FAMILIA_IDS + ["blanco"]
PARES = {
    # las dos estimaciones independientes que pide el plan (comparables entre sí, para publicar):
    "concejo_2019_2023": ("concejo_2019", "concejo_2023"),
    "camara_2022_2026": ("camara_2022", "camara_2026"),
    # tercera, solo para el backtest: la regla de centro `transferencia_matriz` en `model.py` NO
    # puede usar la matriz concejo_2019_2023 para predecir 2023 (esa matriz conoce la respuesta:
    # fue estimada CON el resultado de 2023). Para competir limpio contra persistencia/swing/κ en
    # el backtest necesita una matriz que, como ellas, solo use información anterior a 2023 — de
    # ahí Cámara 2018→2022, el mismo par que ya usa la regla de κ existente para ese propósito.
    "camara_2018_2022": ("camara_2018", "camara_2022"),
    # análogo presidencial de los dos pares de arriba, misma lógica leak-free: 2018→2022 (ambas
    # anteriores a concejo_2023) para el backtest, 2022→2026 (ambas anteriores a concejo_2027) para
    # el pronóstico real. Ver `model.py::centros(..., matriz_pres=...)`.
    "presidente_2018_2022": ("presidente_2018", "presidente_2022"),
    "presidente_2022_2026": ("presidente_2022", "presidente_2026"),
}


def _matriz_puesto_categoria(cat: pd.DataFrame, eleccion: str) -> pd.DataFrame:
    """Pivotea votos_puesto_categoria a puesto_id × categoría (columnas = CATEGORIAS, en orden fijo)."""
    d = cat[(cat["eleccion"] == eleccion) & cat["categoria"].isin(CATEGORIAS) & ~cat["localidad_cod"].isin(C.ESPECIALES)]
    p = d.pivot_table(index="puesto_id", columns="categoria", values="votos", aggfunc="sum", fill_value=0)
    return p.reindex(columns=CATEGORIAS, fill_value=0)


def preparar_par(cat: pd.DataFrame, origen: str, destino: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Devuelve (R, C, puestos): conteos origen/destino (n_puestos, 10) en los mismos puestos físicos."""
    po = _matriz_puesto_categoria(cat, origen)
    pd_ = _matriz_puesto_categoria(cat, destino)
    comunes = po.index.intersection(pd_.index)
    po, pd_ = po.loc[comunes], pd_.loc[comunes]
    # puestos sin votos válidos en origen o destino no aportan información (mezcla indefinida)
    ok = (po.sum(axis=1) > 0) & (pd_.sum(axis=1) > 0)
    return po[ok].to_numpy(dtype="int64"), pd_[ok].to_numpy(dtype="int64"), po.index[ok].tolist()


def ajustar_transferencia(R: np.ndarray, Cc: np.ndarray, categorias: list[str] = CATEGORIAS,
                          draws: int = 900, tune: int = 900, chains: int = 2):
    """Ajusta el modelo de regresión ecológica bayesiana. Devuelve el InferenceData de arviz.

    draws/tune/chains recortados a lo que corre en un rato razonable en un VPS de 3.7GB/2 núcleos
    (cores=1 abajo, cadenas secuenciales, para no competir por RAM); con más cómputo disponible,
    subir chains a 4 da un diagnóstico de convergencia más confiable.
    """
    K = len(categorias)
    origen_frac = R / R.sum(axis=1, keepdims=True)
    n_destino = Cc.sum(axis=1)

    with pm.Model():
        filas = [pm.Dirichlet(f"T_{cat}", a=np.ones(K)) for cat in categorias]
        T = pm.math.stack(filas, axis=0)  # (K, K): T[i, j] = P(destino=j | origen=i)
        kappa = pm.Gamma("kappa", alpha=2, beta=0.01)
        mezcla = pm.math.dot(origen_frac, T)  # (n_puestos, K)
        pm.DirichletMultinomial("c_obs", n=n_destino, a=kappa * mezcla, observed=Cc)
        idata = pm.sample(draws=draws, tune=tune, chains=chains, cores=1, random_seed=C.SEED,
                          target_accept=0.9, progressbar=False)
    return idata


def _min_de_datatree(dt) -> float:
    """arviz 1.x devuelve un DataTree (grupo /posterior) en vez de un Dataset plano."""
    grupo = dt["posterior"] if "posterior" in dt.children else dt
    return float(min(np.min(v.values) for v in grupo.data_vars.values()))


def _max_de_datatree(dt) -> float:
    grupo = dt["posterior"] if "posterior" in dt.children else dt
    return float(max(np.max(v.values) for v in grupo.data_vars.values()))


def resumen_matriz(idata, categorias: list[str] = CATEGORIAS) -> dict:
    """Media posterior, p05/p95 por celda y tamaño efectivo de muestra (diagnóstico de convergencia)."""
    import arviz as az

    K = len(categorias)
    media = np.zeros((K, K))
    p05 = np.zeros((K, K))
    p95 = np.zeros((K, K))
    ess_min = np.inf
    for i, cat in enumerate(categorias):
        post = idata.posterior[f"T_{cat}"]  # dims: chain, draw, T_{cat}_dim_0
        media[i] = post.mean(dim=["chain", "draw"]).values
        p05[i] = post.quantile(0.05, dim=["chain", "draw"]).values
        p95[i] = post.quantile(0.95, dim=["chain", "draw"]).values
        ess_min = min(ess_min, _min_de_datatree(az.ess(idata, var_names=[f"T_{cat}"])))
    rhat_max = _max_de_datatree(az.rhat(idata, var_names=[f"T_{c}" for c in categorias] + ["kappa"]))
    kappa_post = idata.posterior["kappa"].values
    return {
        "categorias": categorias,
        "media": media.round(4).tolist(),
        "p05": p05.round(4).tolist(),
        "p95": p95.round(4).tolist(),
        "kappa_media": float(kappa_post.mean()),
        "ess_min": round(ess_min, 1),
        "rhat_max": round(rhat_max, 4),
    }


def main() -> None:
    cat = pd.read_parquet(C.PROCESSED / "votos_puesto_categoria.parquet")
    reporte = {}
    for nombre, (origen, destino) in PARES.items():
        R, Cc, puestos = preparar_par(cat, origen, destino)
        print(f"{nombre}: {len(puestos)} puestos comunes con votos válidos en ambas elecciones")
        idata = ajustar_transferencia(R, Cc)
        resumen = resumen_matriz(idata)
        resumen["n_puestos"] = len(puestos)
        reporte[nombre] = resumen
        print(f"  kappa≈{resumen['kappa_media']:.1f} · ESS mínimo {resumen['ess_min']} · R-hat máximo {resumen['rhat_max']}")
        idata.to_netcdf(C.INTERIM / f"transferencia_{nombre}.nc")

    (C.PROCESSED / "transferencia.json").write_text(json.dumps(reporte, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OK → data/processed/transferencia.json")


if __name__ == "__main__":
    main()
