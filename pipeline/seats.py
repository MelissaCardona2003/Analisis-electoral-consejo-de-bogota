"""Motor electoral del Concejo: umbral + cifra repartidora (D'Hondt).

- Votos válidos = votos por listas (incluye voto preferente y voto solo por lista) + votos en blanco.
- Cociente electoral = votos válidos / curules a proveer por cifra repartidora.
- Umbral = 50% del cociente (art. 263 C.P. para circunscripciones de más de dos curules).
- Solo las listas que superan el umbral participan en el reparto D'Hondt.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping

import numpy as np

from . import config as C


@dataclass
class Reparto:
    curules: dict[str, int]
    votos_validos: int
    cociente: float
    umbral: float
    cifra_repartidora: float
    siguiente_cociente: float
    ultima_curul: str
    siguiente_en_fila: str | None
    votos_para_otra_curul: dict[str, int]
    colchon_ultima_curul: dict[str, int]


def cifra_repartidora(votos: Mapping[str, int], blancos: int, curules: int = C.CURULES_REPARTIDORA,
                      umbral_fraccion: float = C.UMBRAL_FRACCION_COCIENTE) -> Reparto:
    validos = int(sum(votos.values()) + blancos)
    cociente = validos / curules
    umbral = umbral_fraccion * cociente
    elegibles = {p: v for p, v in votos.items() if v >= umbral and v > 0}

    cocientes = sorted(((v / d, v, p) for p, v in elegibles.items() for d in range(1, curules + 1)),
                       key=lambda t: (t[0], t[1]), reverse=True)
    ganadores = cocientes[:curules]
    asignadas = {p: 0 for p in votos}
    for _, _, p in ganadores:
        asignadas[p] += 1
    cifra = ganadores[-1][0]
    siguiente = cocientes[curules] if len(cocientes) > curules else (0.0, 0, None)

    faltan, colchon = {}, {}
    for p, v in votos.items():
        s = asignadas[p]
        necesario = max(math.floor(cifra * (s + 1)) + 1, math.ceil(umbral))
        faltan[p] = max(necesario - v, 0)
        colchon[p] = int(v - math.ceil(siguiente[0] * s)) if s > 0 else 0

    return Reparto(asignadas, validos, cociente, umbral, cifra, siguiente[0], ganadores[-1][2],
                   siguiente[2], faltan, colchon)


def cifra_repartidora_lote(V: np.ndarray, blancos: np.ndarray, curules: int = C.CURULES_REPARTIDORA,
                           umbral_fraccion: float = C.UMBRAL_FRACCION_COCIENTE) -> np.ndarray:
    """Versión vectorizada para Monte Carlo. ``V``: (simulaciones, listas). Devuelve curules (sim, listas)."""
    V = np.asarray(V, dtype=float)
    S, P = V.shape
    validos = V.sum(axis=1) + np.asarray(blancos, dtype=float)
    umbral = umbral_fraccion * validos / curules
    elegibles = np.where(V >= umbral[:, None], V, 0.0)
    q = (elegibles[:, :, None] / np.arange(1, curules + 1)).reshape(S, -1)
    top = np.argpartition(-q, curules - 1, axis=1)[:, :curules]
    lista = top // curules
    out = np.zeros((S, P), dtype=np.int16)
    np.add.at(out, (np.repeat(np.arange(S), curules), lista.ravel()), 1)
    return out
