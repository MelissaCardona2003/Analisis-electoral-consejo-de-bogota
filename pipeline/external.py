"""Fase 0b — Elecciones externas usadas como indicadores adelantados, filtradas a Bogotá.

Fuentes (Registraduría, observatorio.registraduria.gov.co) y sus formatos, todos distintos:
- Congreso 2022 Bogotá ........ CSV en UTF-16 con nombres
- Congreso 2026 nacional ...... CSV de 9,7 GB solo con códigos + archivos básicos de ancho fijo (cp1252)
- Presidencia 1V 2018 ......... XLSX nacional con hojas MMV / DIVIPOL
- Presidencia 1V 2022 ......... CSV nacional en cp1252 separado por «;», nombres con relleno de espacios
- Presidencia 1V 2026 ......... CSV solo con códigos + archivos básicos de ancho fijo

Todo se normaliza a un esquema largo por puesto de votación.
Uso: ``python -m pipeline.external [presidente_2018 presidente_2022 presidente_2026 congreso_2022 congreso_2026]``
"""
from __future__ import annotations

import argparse
import codecs
import io
import json
import re
import zipfile
from pathlib import Path

import pandas as pd

from . import config as C
from .textnorm import normalize_text, text_key

EXT = C.EXTERNAL
ESPECIALES = {996: "blanco", 997: "nulo", 998: "no_marcado"}
COLS = ["eleccion", "corporacion", "zona", "puesto", "puesto_id", "puesto_nombre", "partido_cod", "partido_nombre",
        "candidato_cod", "candidato_nombre", "tipo", "votos"]
LOG: dict = {}


# ───────────────────────── utilidades ─────────────────────────

def detectar_codificacion(muestra: bytes) -> str:
    if muestra.startswith(codecs.BOM_UTF16_LE) or muestra.startswith(codecs.BOM_UTF16_BE):
        return "utf-16"
    if muestra.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"
    if len(muestra) > 3 and muestra[1:2] == b"\x00" and muestra[3:4] == b"\x00":
        return "utf-16-le"
    try:
        muestra[: len(muestra) - 4].decode("utf-8")  # el corte puede partir un carácter multibyte
        return "utf-8"
    except UnicodeDecodeError:
        return "cp1252"


def _limpiar_nombre(s) -> str:
    return re.sub(r"\s*[.]+$", "", normalize_text(s)).strip()


def _tipo(cand: pd.Series, nombre: pd.Series) -> pd.Series:
    c = pd.to_numeric(cand, errors="coerce").fillna(-1).astype(int)
    tipo = c.map(ESPECIALES).fillna("candidato")
    tipo[c == 0] = "lista"
    k = nombre.map(text_key)
    tipo[k.str.fullmatch(r"(VOTOS? EN BLANCO)")] = "blanco"
    tipo[k.str.fullmatch(r"VOTOS? NULOS?")] = "nulo"
    tipo[k.str.fullmatch(r"VOTOS? NO MARCADOS?|TARJETONES NO MARCADOS")] = "no_marcado"
    return tipo


def _agregar(df: pd.DataFrame, eleccion: str, corporacion: str) -> pd.DataFrame:
    df = df.copy()
    df["zona"] = df["zona"].astype(str).str.strip().str[-2:].str.zfill(2)
    df["puesto"] = df["puesto"].astype(str).str.strip().str.zfill(2)
    df["partido_cod"] = pd.to_numeric(df["partido_cod"], errors="coerce").fillna(0).astype(int).map("{:05d}".format)
    df["candidato_cod"] = pd.to_numeric(df["candidato_cod"], errors="coerce").fillna(0).astype(int).map("{:03d}".format)
    df["votos"] = pd.to_numeric(df["votos"], errors="coerce").fillna(0).astype("int64")
    for col in ("partido_nombre", "candidato_nombre"):
        uniq = df[col].unique()
        df[col] = df[col].map(dict(zip(uniq, (_limpiar_nombre(u) for u in uniq))))
    keys = ["zona", "puesto", "partido_cod", "candidato_cod"]
    out = df.groupby(keys, as_index=False).agg(partido_nombre=("partido_nombre", "first"),
                                               candidato_nombre=("candidato_nombre", "first"),
                                               votos=("votos", "sum"))
    out["tipo"] = _tipo(out["candidato_cod"], out["candidato_nombre"])
    out["eleccion"], out["corporacion"] = eleccion, corporacion
    out["puesto_id"] = out["zona"] + out["puesto"]
    out["puesto_nombre"] = ""
    return out


def decodificar(raw: bytes) -> str:
    """Decodifica un archivo completo: BOM/UTF-16 si aplica; si no, UTF-8 estricto y, si falla, cp1252."""
    enc = detectar_codificacion(raw[:4096])
    if enc.startswith("utf-16") or enc == "utf-8-sig":
        return raw.decode(enc)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


def _csv_en_zip(zf: zipfile.ZipFile, member: str, nombre: str, **kwargs):
    """Itera bloques de un CSV dentro de un zip. Si el UTF-8 falla a mitad de archivo, reinicia en cp1252."""
    with zf.open(member) as fh:
        enc = detectar_codificacion(fh.read(1 << 20))
    for intento in ([enc] if enc.startswith("utf-16") or enc == "utf-8-sig" else [enc, "cp1252"]):
        try:
            with zf.open(member) as fh:
                for ch in pd.read_csv(io.TextIOWrapper(fh, encoding=intento), dtype=str, keep_default_na=False, **kwargs):
                    yield ch
            LOG.setdefault(nombre, {})["codificacion"] = intento
            return
        except UnicodeDecodeError:
            LOG.setdefault(nombre, {}).setdefault("advertencias", []).append(f"{intento} falló; se reintenta")
    raise UnicodeDecodeError("desconocida", b"", 0, 1, f"No se pudo decodificar {member}")


def _leer_ancho_fijo(path: Path, spec: list[tuple[str, int]]) -> pd.DataFrame:
    text = decodificar(path.read_bytes())
    filas = []
    for line in text.splitlines():
        if not line.strip():
            continue
        pos, fila = 0, {}
        for name, width in spec:
            fila[name] = line[pos:pos + width].strip()
            pos += width
        filas.append(fila)
    return pd.DataFrame(filas)


SPEC_PARTIDOS = [("partido_cod", 5), ("partido_nombre", 200)]
SPEC_CANDIDATOS = [("corp", 3), ("circ", 1), ("dep", 2), ("mun", 3), ("comuna", 2), ("partido_cod", 5),
                   ("candidato_cod", 3), ("preferente", 1), ("nombre", 50), ("apellido", 50), ("cedula", 15),
                   ("genero", 1), ("sorteo", 2)]
SPEC_DIVIPOL = [("dep", 2), ("mun", 3), ("zona", 2), ("puesto", 2), ("dep_nombre", 12), ("mun_nombre", 30),
                ("puesto_nombre", 40), ("indicador", 1), ("pot_hombres", 8), ("pot_mujeres", 8), ("mesas", 6),
                ("comuna", 2), ("comuna_nombre", 30)]
SPEC_CODIGOS_MMV = ["fijo", "dep", "mun", "zona", "puesto", "mesa", "comuna", "corp", "circ", "partido_cod",
                    "candidato_cod", "votos"]


def _divipol_bogota(path: Path, eleccion: str) -> pd.DataFrame:
    d = _leer_ancho_fijo(path, SPEC_DIVIPOL)
    d = d[(d["dep"] == "16") & (d["mun"] == "001")].copy()
    for c in ("pot_hombres", "pot_mujeres", "mesas"):
        d[c] = pd.to_numeric(d[c], errors="coerce").fillna(0).astype(int)
    d["potencial"] = d["pot_hombres"] + d["pot_mujeres"]
    d["puesto_id"] = d["zona"].str.zfill(2) + d["puesto"].str.zfill(2)
    d["puesto_nombre"] = d["puesto_nombre"].map(normalize_text)
    d["eleccion"] = eleccion
    return d[["eleccion", "puesto_id", "puesto_nombre", "indicador", "pot_hombres", "pot_mujeres", "potencial", "mesas"]]


def extraer_filas_bogota(zip_path: Path, member: str, destino: Path, prefijo: bytes = b"9999;16;001;") -> Path:
    """Filtra en streaming las filas de Bogotá de un MMV nacional de códigos (sin descomprimirlo a disco)."""
    if destino.exists() and destino.stat().st_size > 0:
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    resto = b""
    with zipfile.ZipFile(zip_path) as zf, zf.open(member) as fh, open(destino, "wb") as out:
        while True:
            bloque = fh.read(64 << 20)
            if not bloque:
                break
            bloque = resto + bloque
            corte = bloque.rfind(b"\n") + 1
            resto = bloque[corte:]
            out.writelines(l + b"\n" for l in bloque[:corte].split(b"\n") if l.startswith(prefijo))
        if resto.startswith(prefijo):
            out.write(resto)
    return destino


def _mmv_codigos(path: Path, filtro) -> pd.DataFrame:
    """Lee un MMV de códigos por bloques y agrega por puesto (el de Congreso 2026 tiene ~28 M filas en Bogotá)."""
    usar = ["zona", "puesto", "corp", "circ", "partido_cod", "candidato_cod", "votos"]
    keys = usar[:-1]
    parts = []
    for ch in pd.read_csv(path, sep=";", header=None, dtype=str, usecols=range(12), names=SPEC_CODIGOS_MMV,
                          keep_default_na=False, chunksize=2_000_000):
        ch = filtro(ch[usar])
        ch["votos"] = pd.to_numeric(ch["votos"], errors="coerce").fillna(0).astype("int64")
        parts.append(ch.groupby(keys, as_index=False)["votos"].sum())
    return pd.concat(parts, ignore_index=True).groupby(keys, as_index=False)["votos"].sum()


# ───────────────────────── fuentes ─────────────────────────

def presidente_2018() -> tuple[pd.DataFrame, pd.DataFrame]:
    import openpyxl
    z = EXT / "MMV_NACIONAL_PRESIDENTE_2018_1v.zip"
    with zipfile.ZipFile(z) as zf:
        member = next(n for n in zf.namelist() if n.lower().endswith(".xlsx"))
        wb = openpyxl.load_workbook(io.BytesIO(zf.read(member)), read_only=True, data_only=True)

    def filas(hoja: str):
        it = wb[hoja].iter_rows(values_only=True)
        header = [text_key(h) for h in next(it)]
        idx = {h: i for i, h in enumerate(header)}
        for r in it:
            if r[idx["DEP"]] is not None and int(r[idx["DEP"]]) == 16 and int(r[idx["MUN"]]) == 1:
                yield idx, r

    mmv = [(r[i["ZONA"]], r[i["PSTO"]], r[i["PAR"]], r[i["PARTIDO"]], r[i["CODCAN"]], r[i["CANDIDATO"]], r[i["VOTOS"]])
           for i, r in filas("MMV ESCRUTINIO FINAL")]
    df = pd.DataFrame(mmv, columns=["zona", "puesto", "partido_cod", "partido_nombre", "candidato_cod",
                                    "candidato_nombre", "votos"])
    out = _agregar(df, "presidente_2018", "PRESIDENTE")
    div = pd.DataFrame([(r[i["ZONA"]], r[i["PSTO"]], r[i["PUESTO"]], r[i["HOMBRE"]], r[i["MUJERES"]], r[i["MESAS"]])
                        for i, r in filas("DIVIPOL")],
                       columns=["zona", "puesto", "puesto_nombre", "pot_hombres", "pot_mujeres", "mesas"])
    div["puesto_id"] = div["zona"].map(lambda v: f"{int(v):02d}") + div["puesto"].map(lambda v: f"{int(v):02d}")
    div["puesto_nombre"] = div["puesto_nombre"].map(normalize_text)
    div["potencial"] = div["pot_hombres"].astype(int) + div["pot_mujeres"].astype(int)
    div["eleccion"], div["indicador"] = "presidente_2018", ""
    out["puesto_nombre"] = out["puesto_id"].map(dict(zip(div["puesto_id"], div["puesto_nombre"]))).fillna("")
    LOG["presidente_2018"] = {"archivo": member, "formato": "xlsx"}
    return out, div[["eleccion", "puesto_id", "puesto_nombre", "indicador", "pot_hombres", "pot_mujeres", "potencial", "mesas"]]


def presidente_2022() -> tuple[pd.DataFrame, None]:
    z = EXT / "MMV_NACIONAL_PRESIDENTE_2022_1v.zip"
    parts = []
    with zipfile.ZipFile(z) as zf:
        member = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(member) as fh:
            enc = detectar_codificacion(fh.read(1 << 20))
        with zf.open(member) as fh:
            reader = pd.read_csv(io.TextIOWrapper(fh, encoding=enc), sep=";", dtype=str, chunksize=500_000,
                                 keep_default_na=False)
            for ch in reader:
                ch.columns = [text_key(c) for c in ch.columns]
                ch = ch[(ch["DEP"].str.strip() == "16") & (ch["MUN"].str.strip() == "001")]
                parts.append(ch)
    df = pd.concat(parts).rename(columns={"ZONA": "zona", "PUESTO": "puesto", "PAR": "partido_cod",
                                          "PARNOMBRE": "partido_nombre", "CAN": "candidato_cod",
                                          "CANNOMBRE": "candidato_nombre", "VOTOS": "votos"})
    out = _agregar(df, "presidente_2022", "PRESIDENTE")
    nombres = df.assign(pid=df["zona"].str.strip().str.zfill(2) + df["puesto"].str.strip().str.zfill(2))
    out["puesto_nombre"] = out["puesto_id"].map(nombres.drop_duplicates("pid").set_index("pid")["PUESNOMBRE"]
                                                .map(normalize_text)).fillna("")
    LOG["presidente_2022"] = {"archivo": member, "codificacion": enc}
    return out, None


def presidente_2026() -> tuple[pd.DataFrame, pd.DataFrame]:
    z = EXT / "MMV_Presidente1V_2026.zip"
    base = EXT / "presidente2026"
    with zipfile.ZipFile(z) as zf:
        member = next(n for n in zf.namelist() if n.endswith("ESCRUTINIO.csv"))
    path = extraer_filas_bogota(z, member, base / "bogota_escrutinio.csv")
    df = _mmv_codigos(path, lambda ch: ch[ch["corp"] == "001"])
    cand = _leer_ancho_fijo(EXT / "basicos" / "presidente2026" / "CANDIDATOS.TXT", SPEC_CANDIDATOS)
    part = _leer_ancho_fijo(EXT / "basicos" / "presidente2026" / "PARTIDOS.TXT", SPEC_PARTIDOS)
    cand["nombre_completo"] = (cand["nombre"] + " " + cand["apellido"]).str.strip()
    key = cand["partido_cod"].astype(int).astype(str) + "-" + cand["candidato_cod"].astype(int).astype(str)
    df["_k"] = df["partido_cod"].astype(int).astype(str) + "-" + df["candidato_cod"].astype(int).astype(str)
    df["candidato_nombre"] = df["_k"].map(dict(zip(key, cand["nombre_completo"])))
    df["partido_nombre"] = df["partido_cod"].astype(int).map(dict(zip(part["partido_cod"].astype(int), part["partido_nombre"])))
    esp = pd.to_numeric(df["candidato_cod"]).map({996: "VOTOS EN BLANCO", 997: "VOTOS NULOS", 998: "VOTOS NO MARCADOS"})
    df["candidato_nombre"] = df["candidato_nombre"].fillna(esp).fillna("")
    df["partido_nombre"] = df["partido_nombre"].fillna("")
    out = _agregar(df, "presidente_2026", "PRESIDENTE")
    div = _divipol_bogota(EXT / "basicos" / "presidente2026" / "DIVIPOL.TXT", "presidente_2026")
    out["puesto_nombre"] = out["puesto_id"].map(dict(zip(div["puesto_id"], div["puesto_nombre"]))).fillna("")
    LOG["presidente_2026"] = {"archivo": member, "formato": "códigos ; + archivos básicos de ancho fijo"}
    return out, div


def congreso_2022() -> tuple[pd.DataFrame, None]:
    z = EXT / "MMV_CONGRESO_2022_BOGOTA.zip"
    parts = []
    with zipfile.ZipFile(z) as zf:
        member = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(member) as fh:
            enc = detectar_codificacion(fh.read(4096))
        with zf.open(member) as fh:
            reader = pd.read_csv(io.TextIOWrapper(fh, encoding=enc), dtype=str, chunksize=500_000,
                                 keep_default_na=False)
            for ch in reader:
                ch.columns = [text_key(c) for c in ch.columns]
                corp = ch["NOMBRE CORPORACION"].str.strip().str.upper()
                circ = ch["NOMBRE CIRCUNSCRIPCION"].map(text_key)
                keep = ((corp == "CAMARA") & (circ == "DEPARTAMENTAL")) | ((corp == "SENADO") & (circ == "NACIONAL"))
                sub = ch.loc[keep, ["CODIGO ZONA", "CODIGO PUESTO", "NOMBRE PUESTO", "CODIGO PARTIDO", "NOMBRE PARTIDO",
                                    "CODIGO CANDIDATO", "NOMBRE CANDIDATO", "TOTAL VOTOS"]].copy()
                sub["corporacion"] = corp[keep]
                sub["TOTAL VOTOS"] = pd.to_numeric(sub["TOTAL VOTOS"], errors="coerce").fillna(0).astype("int64")
                g = sub.groupby(["corporacion", "CODIGO ZONA", "CODIGO PUESTO", "CODIGO PARTIDO", "CODIGO CANDIDATO"],
                                as_index=False).agg(puesto_nombre=("NOMBRE PUESTO", "first"),
                                                    partido_nombre=("NOMBRE PARTIDO", "first"),
                                                    candidato_nombre=("NOMBRE CANDIDATO", "first"),
                                                    votos=("TOTAL VOTOS", "sum"))
                parts.append(g)
    df = pd.concat(parts, ignore_index=True).rename(columns={"CODIGO ZONA": "zona", "CODIGO PUESTO": "puesto",
                                                             "CODIGO PARTIDO": "partido_cod",
                                                             "CODIGO CANDIDATO": "candidato_cod"})
    outs = []
    for corp, sub in df.groupby("corporacion"):
        o = _agregar(sub, f"{corp.lower()}_2022", corp)
        nombres = sub.assign(pid=sub["zona"].str.zfill(2) + sub["puesto"].str.zfill(2)).drop_duplicates("pid")
        o["puesto_nombre"] = o["puesto_id"].map(dict(zip(nombres["pid"], nombres["puesto_nombre"].map(normalize_text))))
        outs.append(o)
    LOG["congreso_2022"] = {"archivo": member, "codificacion": enc}
    return pd.concat(outs, ignore_index=True), None


def congreso_2026() -> tuple[pd.DataFrame, pd.DataFrame]:
    base = EXT / "congreso2026"
    interno = base / "MMV_CONGRESO_2026" / "mmvESCRUTINIOCongreso2026.zip"
    if not interno.exists():
        with zipfile.ZipFile(EXT / "MMV_CONGRESO_2026.zip") as zf:
            zf.extract("MMV_CONGRESO_2026/mmvESCRUTINIOCongreso2026.zip", base)
    path = extraer_filas_bogota(interno, "MMV_9999.csv", base / "bogota_escrutinio.csv")
    df = _mmv_codigos(path, lambda ch: ch[((ch["corp"] == "001") & (ch["circ"] == "0"))
                                          | ((ch["corp"] == "002") & (ch["circ"] == "1"))])
    cand = _leer_ancho_fijo(EXT / "basicos" / "congreso2026" / "CANDIDATOS.TXT", SPEC_CANDIDATOS)
    part = _leer_ancho_fijo(EXT / "basicos" / "congreso2026" / "PARTIDOS.TXT", SPEC_PARTIDOS)
    cand = cand[((cand["corp"] == "001") & (cand["circ"] == "0")) | ((cand["corp"] == "002") & (cand["dep"] == "16"))]
    cand["nombre_completo"] = (cand["nombre"] + " " + cand["apellido"]).str.strip()
    ck = cand["corp"] + "-" + cand["partido_cod"].astype(int).astype(str) + "-" + cand["candidato_cod"].astype(int).astype(str)
    df["_k"] = df["corp"] + "-" + df["partido_cod"].astype(int).astype(str) + "-" + df["candidato_cod"].astype(int).astype(str)
    df["candidato_nombre"] = df["_k"].map(dict(zip(ck, cand["nombre_completo"])))
    df["partido_nombre"] = df["partido_cod"].astype(int).map(dict(zip(part["partido_cod"].astype(int), part["partido_nombre"])))
    esp = pd.to_numeric(df["candidato_cod"]).map({996: "VOTOS EN BLANCO", 997: "VOTOS NULOS", 998: "VOTOS NO MARCADOS"})
    df["candidato_nombre"] = df["candidato_nombre"].fillna(esp).fillna("")
    df["partido_nombre"] = df["partido_nombre"].fillna("")
    div = _divipol_bogota(EXT / "basicos" / "congreso2026" / "DIVIPOL.TXT", "congreso_2026")
    outs = []
    for corp, nombre in (("001", "SENADO"), ("002", "CAMARA")):
        o = _agregar(df[df["corp"] == corp], f"{nombre.lower()}_2026", nombre)
        o["puesto_nombre"] = o["puesto_id"].map(dict(zip(div["puesto_id"], div["puesto_nombre"]))).fillna("")
        outs.append(o)
    LOG["congreso_2026"] = {"archivo": "mmvESCRUTINIOCongreso2026.zip!MMV_9999.csv", "formato": "códigos ;"}
    return pd.concat(outs, ignore_index=True), div


FUENTES = {"presidente_2018": presidente_2018, "presidente_2022": presidente_2022, "presidente_2026": presidente_2026,
           "congreso_2022": congreso_2022, "congreso_2026": congreso_2026}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fuentes", nargs="*", default=list(FUENTES))
    args = ap.parse_args()
    destino = C.INTERIM / "externas"
    destino.mkdir(exist_ok=True)
    for nombre in args.fuentes:
        print(f"Procesando {nombre}…", flush=True)
        votos, divipol = FUENTES[nombre]()
        votos[COLS].to_parquet(destino / f"{nombre}.parquet", index=False)
        if divipol is not None:
            divipol.to_parquet(destino / f"divipol_{nombre}.parquet", index=False)
        resumen = {}
        for (el, corp), g in votos.groupby(["eleccion", "corporacion"]):
            resumen[el] = {"puestos": int(g["puesto_id"].nunique()),
                           "votos_por_tipo": {k: int(v) for k, v in g.groupby("tipo")["votos"].sum().items()}}
        LOG.setdefault(nombre, {})["resumen"] = resumen
        print(json.dumps(resumen, ensure_ascii=False), flush=True)
    rep = C.REPORTS / "calidad_externas.json"
    previo = json.loads(rep.read_text(encoding="utf-8")) if rep.exists() else {}
    previo.update(LOG)
    rep.write_text(json.dumps(previo, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
