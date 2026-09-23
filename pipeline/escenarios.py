"""Fase 3 — Escenarios declarativos sobre el pronóstico (``reference/escenarios/*.yaml``).

El pronóstico por defecto lo decide el modelo de datos (backtest + Monte Carlo, ver `model.py`). Un
escenario es una hipótesis política EXPLÍCITA — "Alianza Verde se debilita y surge un partido nuevo",
por ejemplo— que alguien plantea en prosa y que se quiere ver reflejada en el simulador, rotulada como
supuesto y nunca mezclada con el caso base.

El rol de la IA aquí es acotado a dos puntos, nunca a estimar curules:
  1. Traducir la prosa de la hipótesis a este spec YAML (estructurado, con conservación de masa
     verificable). Un humano revisa y aprueba el spec antes de usarlo — el artefacto auditable es el
     YAML, no la prosa ni el criterio del modelo que lo tradujo.
  2. Redactar, al final, una narrativa en prosa de los resultados YA calculados por el Monte Carlo.

Todo el cálculo de curules en el medio —de dónde salen los votos, cuántas curules da cada reparto— lo
sigue haciendo exactamente el mismo motor que el pronóstico base: `centro_matriz`/`simular`/
`cifra_repartidora_lote`. Un escenario nunca inventa un número de curules; ajusta la cuota de entrada
del mismo Monte Carlo que ya existía.

Formato del YAML (ver ``reference/escenarios/*.yaml`` para ejemplos reales):

    id: identificador_corto
    nombre: "Título para mostrar"
    descripcion: >
      Explicación en prosa de la hipótesis y su alcance.
    fuente: "de dónde salió la hipótesis (para trazabilidad, no se muestra al público)"
    transferencia:            # opcional: ajusta filas de la matriz de transferencia — SOLO entre
      alianza_verde:          # familias EXISTENTES (una de FAMILIA_IDS). Nunca pongas aquí el id de
        alianza_verde: 0.55   # una lista de `listas_nuevas`: su origen se declara solo en su `desde`
        pacto_historico: 0.20 # (ponerlo en los dos lados resta el mismo voto dos veces). La fila debe
        otros: 0.25           # sumar 1.0 (conservación de masa) usando solo familias existentes.
    multiplicadores:          # opcional: alternativa más simple a `transferencia` (reescala y renormaliza)
      pacto_historico: 1.15
    listas_nuevas:            # opcional: partidos sin historial en el Concejo
      - id: nuevo_partido
        nombre: "Nombre para mostrar"
        cuota_prior: {media: 0.06, sd_log: 0.4}   # media = mediana de cuota de votos válidos (0 a 0.35)
        desde: {alianza_verde: 1.0}               # de qué familia(s) EXISTENTES sale su votación
        familia_mostrar: otros                    # opcional; por defecto "otros"

Uso:
  ``python -m pipeline.escenarios`` corre todos los YAML de ``reference/escenarios/`` sobre el
  pronóstico ya calculado (requiere haber corrido antes ``python -m pipeline.model``) y escribe
  ``data/processed/escenarios_ia.json``.

  ``python -m pipeline.escenarios --traducir archivo.txt --salida reference/escenarios/nombre.yaml``
  traduce una hipótesis en prosa (Fase 3.4 punto 1) usando la API gratuita de Gemini Flash — requiere
  la variable de entorno ``GEMINI_API_KEY`` (ver https://aistudio.google.com/apikey). El YAML que
  produce SIEMPRE se valida antes de guardarse, pero un humano debe revisarlo y ajustarlo igual: el
  traductor solo genera un borrador, nunca un spec final.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from . import config as C
from . import model as M
from .partidos import FAMILIA_IDS

CATS = FAMILIA_IDS + ["blanco"]
IDX = {c: i for i, c in enumerate(CATS)}


# ───────────────────────── carga y validación ─────────────────────────

def cargar_escenario(path) -> dict:
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    errores = validar_escenario(spec)
    if errores:
        raise ValueError(f"{path.name}: escenario inválido —\n" + "\n".join(f"  - {e}" for e in errores))
    return spec


def validar_escenario(spec: dict) -> list[str]:
    """Conservación de masa y referencias válidas. Devuelve la lista de errores (vacía si es válido)."""
    errores = []
    for campo in ("id", "nombre", "descripcion"):
        if not spec.get(campo):
            errores.append(f"falta el campo obligatorio '{campo}'")

    listas_nuevas = spec.get("listas_nuevas") or []
    ids_nuevos = set()
    for i, lista in enumerate(listas_nuevas):
        ref = lista.get("id", f"#{i}")
        for campo in ("id", "nombre", "cuota_prior"):
            if campo not in lista:
                errores.append(f"listas_nuevas.{ref}: falta '{campo}'")
        if "cuota_prior" in lista:
            for campo in ("media", "sd_log"):
                if campo not in lista["cuota_prior"]:
                    errores.append(f"listas_nuevas.{ref}.cuota_prior: falta '{campo}'")
            media = lista["cuota_prior"].get("media", 0)
            if not (0 < media < 0.35):
                errores.append(f"listas_nuevas.{ref}.cuota_prior.media={media}: debe estar entre 0 y 0.35")
        for fam in (lista.get("desde") or {}):
            if fam not in CATS:
                errores.append(f"listas_nuevas.{ref}.desde: '{fam}' no es una familia válida")
        if "id" in lista:
            ids_nuevos.add(lista["id"])

    for origen, fila in (spec.get("transferencia") or {}).items():
        if origen not in FAMILIA_IDS:
            errores.append(f"transferencia: '{origen}' no es una familia válida (no se transfiere fuera de blanco)")
            continue
        # las listas nuevas NO pueden ser destino aquí: su origen se define solo en `desde`. Permitir
        # ambos a la vez fue un bug real (se detectó restando el mismo voto de Verde dos veces: una en
        # la fila de transferencia y otra en el `desde` de la lista nueva) — un único lugar por dato.
        en_listas_nuevas = set(fila) & ids_nuevos
        if en_listas_nuevas:
            errores.append(f"transferencia.{origen}: {sorted(en_listas_nuevas)} son listas nuevas — su origen se declara "
                          f"en listas_nuevas.desde, no aquí (declararlo en los dos lados resta el mismo voto dos veces)")
        desconocidos = set(fila) - set(CATS) - ids_nuevos
        if desconocidos:
            errores.append(f"transferencia.{origen}: destino(s) desconocidos {sorted(desconocidos)}")
        total = sum(v for d, v in fila.items() if d in CATS)
        if not en_listas_nuevas and abs(total - 1.0) > 0.01:
            errores.append(f"transferencia.{origen}: las fracciones suman {total:.3f}, deben sumar 1.0 (conservación de masa)")

    for fam, factor in (spec.get("multiplicadores") or {}).items():
        if fam not in CATS:
            errores.append(f"multiplicadores: '{fam}' no es una familia válida")
        elif factor <= 0:
            errores.append(f"multiplicadores.{fam}={factor}: debe ser positivo")

    return errores


# ───────────────────────── aplicación al motor ─────────────────────────

def _matriz_ajustada(spec: dict) -> np.ndarray:
    """Matriz CATS×CATS: identidad salvo en las filas que el escenario ajusta explícitamente. Solo
    redistribuye entre familias EXISTENTES — de cuánto de eso además se va a una lista nueva se encarga
    únicamente `desde` en `listas_nuevas` (ver `validar_escenario`: mezclar las dos fuentes para el
    mismo origen restaría el mismo voto dos veces, y es justo el bug que este diseño evita).
    """
    K = len(CATS)
    T = np.eye(K)
    for origen, fila in (spec.get("transferencia") or {}).items():
        v = np.zeros(K)
        for destino, frac in fila.items():
            if destino in IDX:
                v[IDX[destino]] = frac
        T[IDX[origen]] = v
    return T


def aplicar_escenario(spec: dict, s: np.ndarray) -> tuple[np.ndarray, list[dict], dict[str, str]]:
    """``s``: cuotas base (vector CATS, ya en espacio de probabilidad, no logit) — normalmente el
    centro elegido por el backtest, para no mezclar el efecto del escenario con el de cambiar de regla.

    Devuelve (mu_ajustado en logit, emergentes para `simular`, familia_extra para `curules_por_familia`).
    """
    listas_nuevas = spec.get("listas_nuevas") or []

    T = _matriz_ajustada(spec)
    s_nueva = s @ T

    for fam, factor in (spec.get("multiplicadores") or {}).items():
        s_nueva[IDX[fam]] *= factor
    s_nueva = M.normalizar(s_nueva)

    emergentes = [{"id": l["id"], "cuota_base": float(l["cuota_prior"]["media"]),
                  "mu_log": 0.0, "sd_log": float(l["cuota_prior"]["sd_log"]),
                  **({"desde": l["desde"]} if l.get("desde") else {})}
                  for l in listas_nuevas]
    familia_extra = {l["id"]: l.get("familia_mostrar", "otros") for l in listas_nuevas}
    return M.logit(s_nueva), emergentes, familia_extra


def simular_escenario(spec: dict, S: pd.DataFrame, mu_base: np.ndarray, ruido: tuple[float, float],
                      estructura: list[dict], n: int) -> dict:
    """Corre el escenario sobre el MISMO Monte Carlo del pronóstico base. No estima curules "a mano":
    llama a `model.simular` con la cuota de entrada ajustada, igual que cualquier otra regla de centro.
    """
    s_base = M.normalizar(M.inv_logit(mu_base))
    mu_ajustado, emergentes, familia_extra = aplicar_escenario(spec, s_base)
    P, L, cur, ids = M.simular(mu_ajustado, ruido, estructura, n, emergentes or None)
    F = M.curules_por_familia(cur, ids, familia_extra)
    listas_nuevas_out = [{"id": l["id"], "nombre": l["nombre"],
                          "curules": M.resumen_curules(cur[:, ids.index(l["id"])]) if l["id"] in ids else None}
                         for l in (spec.get("listas_nuevas") or [])]
    return {
        "id": spec["id"], "nombre": spec["nombre"], "descripcion": spec["descripcion"],
        "familias": {f: M.resumen_distribucion(F[:, k]) for k, f in enumerate(FAMILIA_IDS)},
        "listas_nuevas": listas_nuevas_out,
        "cuotas": {c: float(v) for c, v in zip(CATS, s_base)},
        "cuotas_ajustadas": {c: float(v) for c, v in zip(CATS, M.normalizar(M.inv_logit(mu_ajustado)))},
    }


# ───────────────────────── principal ─────────────────────────

# ───────────────────────── traductor de prosa a spec (Gemini, opcional) ─────────────────────────

PROMPT_SISTEMA = """Eres un traductor de hipótesis políticas a un spec YAML para un simulador electoral \
del Concejo de Bogotá. Debes producir ÚNICAMENTE el YAML, sin explicación ni bloques de código markdown.

Formato exacto:

id: identificador_corto_sin_espacios
nombre: "Título corto para mostrar"
descripcion: >
  Explicación en prosa de la hipótesis, qué asume y sus límites. Deja explícito que los números son
  ilustrativos (traducen la dirección cualitativa del texto, no una medición) y deben revisarse.
fuente: "de dónde salió esta hipótesis"
transferencia:                 # opcional
  <familia_origen>:            # debe ser una de: {familias}
    <familia_destino>: <fraccion>   # SOLO familias de esa lista; deben sumar 1.0 en cada fila
multiplicadores:                # opcional, alternativa simple: reescala una familia existente
  <familia>: <factor positivo>
listas_nuevas:                  # opcional: partidos sin historial en el Concejo
  - id: identificador_lista_nueva
    nombre: "Nombre para mostrar"
    cuota_prior: {{media: <0 a 0.35>, sd_log: <0.3 a 0.6>}}
    desde: {{<familia_existente>: <peso>, ...}}   # de dónde sale su votación
    familia_mostrar: otros      # opcional, por defecto "otros"

Reglas estrictas (ver también validar_escenario en pipeline/escenarios.py):
- Los ids de `listas_nuevas` NUNCA pueden aparecer como destino dentro de `transferencia` — su origen
  se declara solo en su propio `desde`. Ponerlo en los dos lados resta el mismo voto dos veces.
- Cada fila de `transferencia` debe sumar exactamente 1.0 usando solo familias de la lista {familias}.
- Si el texto nombra varios escenarios distintos (p. ej. "escenario base", "escenario de alta
  fragmentación"), NO los mezcles en un solo YAML: elige y traduce SOLO el escenario que se te pida
  (o el primero que aparezca, si no se especifica cuál), dejando claro en `descripcion` cuál elegiste
  y que los demás quedan pendientes de traducir aparte.
"""


def _llamar_con_reintentos(req: urllib.request.Request, intentos: int = 3, espera_inicial: float = 2.0) -> dict:
    """Reintenta con backoff exponencial solo ante errores TRANSITORIOS del servicio (503/429) — el
    free tier de Gemini los produce con cierta frecuencia bajo demanda alta. Cualquier otro error
    (404 modelo inválido, 400 solicitud mal formada, 403 key inválida) se propaga de inmediato: no es
    algo que reintentar vaya a arreglar.
    """
    espera = espera_inicial
    for intento in range(intentos):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode("utf-8", "replace")
            if e.code in (503, 429) and intento < intentos - 1:
                time.sleep(espera)
                espera *= 2
                continue
            raise RuntimeError(f"Gemini devolvió {e.code}: {cuerpo}") from e
    raise RuntimeError("Gemini no respondió tras varios reintentos")  # inalcanzable, calma a los linters


def traducir_con_ia(prosa: str, api_key: str | None = None, modelo: str = "gemini-flash-latest",
                    max_reintentos: int = 2) -> dict:
    """Traduce una hipótesis en prosa al spec YAML de escenarios, con la API gratuita de Gemini Flash.

    ``modelo``: "gemini-flash-latest" es el alias que Google mantiene apuntando a su Flash vigente;
    no se probó en vivo (sin API key disponible al escribir esto) — si Google lo retira o cambia de
    nombre, verificar el id exacto en https://ai.google.dev/gemini-api/docs/models antes de usarlo.

    Fase 3.4 punto 1 del plan: "el LLM traduce, un humano revisa y aprueba" — esto SOLO genera un
    borrador ya validado mecánicamente (conservación de masa, referencias); una persona debe revisarlo
    igual antes de tratarlo como spec final. Si el YAML no valida, se le devuelve el error al modelo
    para que se corrija (hasta ``max_reintentos`` veces) antes de rendirse — la IA nunca decide sola
    que un spec inválido pasa.
    """
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY (variable de entorno) — consigue una gratis en https://aistudio.google.com/apikey")

    sistema = PROMPT_SISTEMA.format(familias=", ".join(CATS))
    mensaje = f"Hipótesis a traducir:\n\n{prosa}"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={api_key}"
    errores: list[str] = []

    for _ in range(max_reintentos + 1):
        cuerpo = json.dumps({
            "system_instruction": {"parts": [{"text": sistema}]},
            "contents": [{"parts": [{"text": mensaje}]}],
            "generationConfig": {"temperature": 0.2},
        }).encode("utf-8")
        req = urllib.request.Request(url, data=cuerpo, headers={"Content-Type": "application/json"}, method="POST")
        datos = _llamar_con_reintentos(req)
        texto = datos["candidates"][0]["content"]["parts"][0]["text"]
        texto = texto.strip().removeprefix("```yaml").removeprefix("```").removesuffix("```").strip()
        try:
            spec = yaml.safe_load(texto)
            errores = validar_escenario(spec)
        except Exception as e:  # YAML mal formado también es "un error que corregir"
            spec, errores = None, [f"YAML mal formado: {e}"]
        if not errores:
            return spec
        mensaje = ("El YAML que generaste tiene estos errores, corrígelos y responde solo con el YAML corregido "
                  "(sin explicación, sin bloques de código):\n" + "\n".join(f"- {e}" for e in errores) +
                  f"\n\nYAML anterior:\n{texto}")

    raise ValueError(f"La IA no produjo un spec válido tras {max_reintentos + 1} intentos. Últimos errores:\n"
                     + "\n".join(f"- {e}" for e in errores))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--traducir", metavar="ARCHIVO.txt", help="traduce una hipótesis en prosa a YAML con Gemini (requiere GEMINI_API_KEY)")
    ap.add_argument("--salida", metavar="ARCHIVO.yaml", help="dónde guardar el YAML traducido (por defecto reference/escenarios/<id>.yaml)")
    args = ap.parse_args()

    if args.traducir:
        prosa = Path(args.traducir).read_text(encoding="utf-8")
        spec = traducir_con_ia(prosa)
        salida = Path(args.salida) if args.salida else C.REFERENCE / "escenarios" / f"{spec['id']}.yaml"
        salida.write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False, width=100), encoding="utf-8")
        print(f"OK → {salida}")
        print("Revísalo y ajústalo antes de tratarlo como spec final — el traductor solo genera un borrador.")
        return

    modelo = json.loads((C.PROCESSED / "modelo.json").read_text(encoding="utf-8"))
    pr = modelo["pronostico"]
    vol = pr["volatilidad"]
    S = M.tabla_cuotas()
    listas = pd.read_csv(C.PROCESSED / "concejo_listas.csv")
    L23 = listas[listas["anio"] == 2023]
    estructura = [{"id": r.lista_id, "familia": r.familia_id, "peso": float(r.votos)} for r in L23.itertuples()]
    mu_base = M.logit(np.array([pr["centro_cuotas"][c] for c in CATS]))
    ruido = (vol["nu"], vol["escala_t"])

    carpeta = C.REFERENCE / "escenarios"
    resultados = {}
    for path in sorted(carpeta.glob("*.yaml")):
        spec = cargar_escenario(path)
        resultados[spec["id"]] = simular_escenario(spec, S, mu_base, ruido, estructura, C.N_SIMULACIONES // 2)
        print(f"  {spec['id']:32s} OK — {spec['nombre']}")

    (C.PROCESSED / "escenarios_ia.json").write_text(json.dumps(resultados, ensure_ascii=False, indent=2, default=float),
                                                     encoding="utf-8")
    print(f"OK → data/processed/escenarios_ia.json ({len(resultados)} escenario(s))")


if __name__ == "__main__":
    main()
