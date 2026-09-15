"""Normalización de texto para datos electorales descargados.

Problemas que resuelve (vistos en los archivos de la Registraduría):
- mojibake por doble codificación (``USAQUÃ‰N`` -> ``USAQUÉN``)
- caracteres de control, BOM, espacios de ancho cero y NBSP
- espacios dobles y espacios rotos dentro de palabras (``LA RA BOGOTÁ``)
- tildes y eñes inconsistentes entre años (``NINO`` vs ``NIÑO``) -> se comparan con ``text_key``
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

from ftfy import fix_text

# Rangos de caracteres invisibles: control C0/C1, guion suave, ancho cero, separadores, BOM.
_INVISIBLE_RANGES = [(0x00, 0x1F), (0x7F, 0x9F), (0xAD, 0xAD), (0x200B, 0x200F), (0x2028, 0x202F),
                     (0x205F, 0x206F), (0xFEFF, 0xFEFF)]
_INVISIBLE = re.compile("[" + "".join(f"{re.escape(chr(a))}-{re.escape(chr(b))}" for a, b in _INVISIBLE_RANGES) + "]")
_C0 = re.compile("[" + re.escape(chr(0)) + "-" + re.escape(chr(0x1F)) + re.escape(chr(0x7F)) + "]")
_SPACES = re.compile(r"\s+")
_NBSP = chr(0xA0)

LOCALIDADES = {
    1: "Usaquén", 2: "Chapinero", 3: "Santa Fe", 4: "San Cristóbal", 5: "Usme",
    6: "Tunjuelito", 7: "Bosa", 8: "Kennedy", 9: "Fontibón", 10: "Engativá",
    11: "Suba", 12: "Barrios Unidos", 13: "Teusaquillo", 14: "Los Mártires",
    15: "Antonio Nariño", 16: "Puente Aranda", 17: "La Candelaria",
    18: "Rafael Uribe Uribe", 19: "Ciudad Bolívar", 20: "Sumapaz",
    90: "Puesto censo (Corferias)", 98: "Centros de reclusión",
}


def is_missing(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def normalize_text(value) -> str:
    """Texto canónico en mayúsculas: repara mojibake, NFC, sin invisibles, espacios colapsados."""
    if is_missing(value):
        return ""
    # Los controles C0 nunca forman parte de un mojibake: se vuelven espacio antes de que ftfy los borre.
    s = _C0.sub(" ", str(value))
    s = fix_text(s, unescape_html=False)
    s = unicodedata.normalize("NFC", s)
    s = s.replace(_NBSP, " ")
    s = _INVISIBLE.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    return s.upper()


def text_key(value) -> str:
    """Llave de comparación: sin tildes ni eñes, solo alfanuméricos y espacios."""
    s = unicodedata.normalize("NFD", normalize_text(value))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return _SPACES.sub(" ", s).strip()


_LOWER_WORDS = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "EL", "EN", "A", "O", "U", "PARA", "POR", "CON", "AL", "SIN"}
_UPPER_WORDS = {"IED", "CED", "UPZ", "SENA", "CDI", "CAFAM", "INEM", "IDRD", "ESAP", "UNAD", "ETB", "UP", "MAIS",
                "ASI", "ADA", "PRE", "FARC", "AICO", "CJL", "MIRA", "D.C.", "DC", "II", "III", "IV", "VI"}


def _cap(word: str) -> str:
    out, upper_next = [], True
    for ch in word.lower():
        out.append(ch.upper() if upper_next and ch.isalpha() else ch)
        if ch.isalpha():
            upper_next = False
        elif ch in "-(\"'/.":
            upper_next = True
    return "".join(out)


def title_case_es(value) -> str:
    """Formato de visualización en español: ``COLEGIO SAN JOSE DE LA SALLE`` -> ``Colegio San Jose de la Salle``.

    No inventa tildes en nombres propios: solo cambia mayúsculas/minúsculas.
    """
    words = normalize_text(value).split(" ")
    out = []
    for i, w in enumerate(words):
        bare = w.strip("\"'()")
        if i > 0 and bare in _LOWER_WORDS:
            out.append(w.lower())
        elif bare in _UPPER_WORDS:
            out.append(w)
        else:
            out.append(_cap(w))
    return " ".join(out)


_LOCALIDAD_RE = re.compile(r"LOCALIDAD\s*(\d{1,2})")


def parse_localidad_codigo(comuna_nombre) -> int | None:
    """``01LOCALIDAD 1 USAQUEN`` -> 1, ``LOCALIDAD  8 KENNEDY`` -> 8, ``NACIONAL`` -> None."""
    m = _LOCALIDAD_RE.search(normalize_text(comuna_nombre))
    return int(m.group(1)) if m else None


@dataclass
class SpaceRepairer:
    """Une fragmentos de palabras separados por un espacio espurio (``POL ITICO`` -> ``POLITICO``).

    Se construye con el vocabulario de los textos únicos del corpus. Solo aplica un cambio cuando es
    inequívoco; los casos ambiguos quedan registrados en ``flagged`` para revisión manual.
    """

    corpus: Iterable[str]
    min_freq: int = 2
    overrides: dict[str, str] = field(default_factory=dict)
    vocab: Counter = field(init=False)
    changes: list[tuple[str, str]] = field(init=False, default_factory=list)
    flagged: list[str] = field(init=False, default_factory=list)

    def __post_init__(self) -> None:
        counts: Counter = Counter()
        for text in set(self.corpus):
            counts.update(text_key(text).split(" "))
        self.vocab = Counter({t: c for t, c in counts.items() if c >= self.min_freq and len(t) >= 2})
        for t in ("Y", "A", "O", "E", "U"):
            self.vocab[t] = max(self.vocab[t], self.min_freq)
        self._cache: dict[str, str] = {}

    def _word(self, token: str) -> bool:
        return text_key(token) in self.vocab

    def _joinable(self, a: str, b: str) -> bool:
        # tokens de pura puntuación ("-", '"') nunca son fragmentos de palabra
        if not text_key(a) or not text_key(b) or not a[-1].isalpha() or not b[0].isalpha():
            return False
        return self._word(a + b) and len(text_key(a + b)) >= 4

    def repair(self, text: str) -> str:
        if text in self._cache:
            return self._cache[text]
        original = normalize_text(text)
        if original in self.overrides:
            fixed = self.overrides[original]
        else:
            toks = original.split(" ")
            out: list[str] = []
            i = 0
            ambiguous = False
            while i < len(toks):
                cur = toks[i]
                nxt = toks[i + 1] if i + 1 < len(toks) else None
                if nxt is not None and self._joinable(cur, nxt):
                    cur_word, nxt_word = self._word(cur), self._word(nxt)
                    if not cur_word and not nxt_word:
                        out.append(cur + nxt)
                        i += 2
                        continue
                    fragment_is_next = cur_word and not nxt_word
                    fragment = nxt if fragment_is_next else cur
                    if cur_word != nxt_word and len(text_key(fragment)) <= 3:
                        # si el fragmento también podría unirse al otro vecino, el caso es ambiguo
                        if fragment_is_next:
                            after = toks[i + 2] if i + 2 < len(toks) else None
                            alt = after is not None and self._joinable(nxt, after)
                        else:
                            before = out[-1] if out else None
                            alt = before is not None and self._joinable(before, cur)
                        if not alt:
                            out.append(cur + nxt)
                            i += 2
                            continue
                        ambiguous = True
                out.append(cur)
                i += 1
            fixed = " ".join(out)
            if ambiguous:
                self.flagged.append(original)
        if fixed != original:
            self.changes.append((original, fixed))
        self._cache[text] = fixed
        return fixed
