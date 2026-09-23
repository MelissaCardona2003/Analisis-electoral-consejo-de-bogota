import json
from io import BytesIO
from unittest.mock import patch

import numpy as np
import pytest

from pipeline import model as M
from pipeline.escenarios import CATS, aplicar_escenario, traducir_con_ia, validar_escenario


def _spec_base(**overrides):
    spec = {
        "id": "prueba", "nombre": "Prueba", "descripcion": "spec de prueba",
        "transferencia": {"alianza_verde": {"alianza_verde": 0.7, "pacto_historico": 0.3}},
        "listas_nuevas": [{"id": "nuevo", "nombre": "Partido nuevo", "cuota_prior": {"media": 0.06, "sd_log": 0.4},
                           "desde": {"alianza_verde": 1.0}}],
    }
    spec.update(overrides)
    return spec


def test_escenario_valido_no_tiene_errores():
    assert validar_escenario(_spec_base()) == []


def test_fila_de_transferencia_debe_sumar_uno():
    spec = _spec_base(transferencia={"alianza_verde": {"alianza_verde": 0.5, "pacto_historico": 0.2}})  # suma 0.7
    errores = validar_escenario(spec)
    assert any("suman" in e for e in errores)


def test_destino_desconocido_en_transferencia_es_error():
    spec = _spec_base(transferencia={"alianza_verde": {"alianza_verde": 0.7, "un_partido_inventado": 0.3}})
    errores = validar_escenario(spec)
    assert any("desconocidos" in e for e in errores)


def test_lista_nueva_como_destino_de_transferencia_es_error():
    # Regresión: declarar la misma lista nueva como destino en `transferencia` Y en `desde` restaba
    # el mismo voto dos veces (se detectó con la hipótesis de fragmentación: Alianza Verde caía a
    # niveles absurdos). El origen de una lista nueva se declara solo en su propio `desde`.
    spec = _spec_base(transferencia={"alianza_verde": {"alianza_verde": 0.7, "nuevo": 0.3}})
    errores = validar_escenario(spec)
    assert any("nuevo" in e and "dos veces" in e for e in errores)


def test_origen_no_familia_es_error():
    spec = _spec_base(transferencia={"blanco": {"blanco": 1.0}})
    errores = validar_escenario(spec)
    assert any("no es una familia válida" in e for e in errores)


def test_faltan_campos_obligatorios():
    errores = validar_escenario({"id": "x"})
    assert any("nombre" in e for e in errores) and any("descripcion" in e for e in errores)


def test_cuota_prior_fuera_de_rango_es_error():
    spec = _spec_base(listas_nuevas=[{"id": "nuevo", "nombre": "N", "cuota_prior": {"media": 0.9, "sd_log": 0.4}}])
    errores = validar_escenario(spec)
    assert any("cuota_prior.media" in e for e in errores)


def test_aplicar_escenario_conserva_masa():
    s = np.array([0.30, 0.20, 0.10, 0.10, 0.08, 0.07, 0.06, 0.04, 0.03, 0.02])  # 10 categorías, suma 1
    assert len(s) == len(CATS)
    mu, emergentes, familia_extra = aplicar_escenario(_spec_base(), s)
    s_final = M.normalizar(M.inv_logit(mu))
    np.testing.assert_allclose(s_final.sum(), 1.0, atol=1e-9)
    assert emergentes[0]["id"] == "nuevo"
    assert emergentes[0]["desde"] == {"alianza_verde": 1.0}
    assert familia_extra == {"nuevo": "otros"}


def test_aplicar_escenario_sin_transferencia_ni_listas_nuevas_no_cambia_nada():
    s = M.normalizar(np.ones(len(CATS)))
    spec = {"id": "neutro", "nombre": "Neutro", "descripcion": "sin ajustes"}
    mu, emergentes, familia_extra = aplicar_escenario(spec, s)
    np.testing.assert_allclose(M.normalizar(M.inv_logit(mu)), s, atol=1e-9)
    assert emergentes == [] and familia_extra == {}


def test_multiplicador_favorece_la_familia_elegida():
    s = M.normalizar(np.ones(len(CATS)))
    spec = {"id": "x", "nombre": "x", "descripcion": "x", "multiplicadores": {"pacto_historico": 1.5}}
    mu, _, _ = aplicar_escenario(spec, s)
    s_final = M.normalizar(M.inv_logit(mu))
    idx = CATS.index("pacto_historico")
    assert s_final[idx] > s[idx]


def test_simular_escenario_end_to_end_conserva_masa_con_emergente():
    s = np.array([0.30, 0.20, 0.10, 0.10, 0.08, 0.07, 0.06, 0.04, 0.03, 0.02])
    mu_base = M.logit(s)
    estructura = [{"id": "lista_verde", "familia": "alianza_verde", "peso": 1.0},
                  {"id": "lista_pacto", "familia": "pacto_historico", "peso": 1.0},
                  {"id": "lista_nl", "familia": "nuevo_liberalismo", "peso": 1.0},
                  {"id": "lista_lib", "familia": "liberal", "peso": 1.0},
                  {"id": "lista_crm", "familia": "cr_mira_u", "peso": 1.0},
                  {"id": "lista_ccjl", "familia": "conservador_cjl", "peso": 1.0},
                  {"id": "lista_cd", "familia": "centro_democratico", "peso": 1.0},
                  {"id": "lista_sn", "familia": "salvacion_nacional", "peso": 1.0},
                  {"id": "lista_otros", "familia": "otros", "peso": 1.0}]
    from pipeline.escenarios import simular_escenario
    resultado = simular_escenario(_spec_base(), None, mu_base, (30.0, 0.1), estructura, n=500)
    assert resultado["id"] == "prueba"
    assert resultado["listas_nuevas"][0]["curules"] is not None
    # curules_por_familia ya incluye a "nuevo" bajo "otros" (vía familia_extra): las 9 familias deben
    # repartir, en conjunto, las 44 de la cifra repartidora — sin sumar la lista nueva aparte, sería doble conteo.
    from pipeline import config as C
    total_curules_familias = sum(v["media"] for v in resultado["familias"].values())
    np.testing.assert_allclose(total_curules_familias, C.CURULES_REPARTIDORA, atol=1e-6)


def _respuesta_gemini(texto: str):
    cuerpo = json.dumps({"candidates": [{"content": {"parts": [{"text": texto}]}}]}).encode("utf-8")
    resp = BytesIO(cuerpo)
    resp.getcode = lambda: 200
    return resp


def test_traducir_con_ia_sin_api_key_falla_claro():
    with patch.dict("os.environ", {}, clear=True), pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        traducir_con_ia("cualquier hipótesis")


def test_traducir_con_ia_reintenta_ante_503_transitorio():
    import urllib.error

    valido = "id: x\nnombre: X\ndescripcion: prueba\nmultiplicadores:\n  pacto_historico: 1.1\n"
    error_503 = urllib.error.HTTPError("url", 503, "Service Unavailable", {}, BytesIO(b'{"error": "high demand"}'))
    with patch.dict("os.environ", {"GEMINI_API_KEY": "clave-de-prueba"}), \
         patch("time.sleep"), \
         patch("urllib.request.urlopen", side_effect=[error_503, _respuesta_gemini(valido)]) as mock_urlopen:
        spec = traducir_con_ia("hipótesis")
    assert spec["id"] == "x"
    assert mock_urlopen.call_count == 2  # el 503 no cuenta como "intento de traducción" agotado


def test_traducir_con_ia_no_reintenta_ante_error_no_transitorio():
    import urllib.error

    error_404 = urllib.error.HTTPError("url", 404, "Not Found", {}, BytesIO(b'{"error": "modelo no existe"}'))
    with patch.dict("os.environ", {"GEMINI_API_KEY": "clave-de-prueba"}), \
         patch("urllib.request.urlopen", side_effect=error_404) as mock_urlopen, \
         pytest.raises(RuntimeError, match="404"):
        traducir_con_ia("hipótesis")
    assert mock_urlopen.call_count == 1  # un 404 no es transitorio: no vale la pena reintentar


def test_traducir_con_ia_acepta_yaml_con_fences_de_markdown():
    yaml_valido = "id: x\nnombre: X\ndescripcion: prueba\nmultiplicadores:\n  pacto_historico: 1.1\n"
    with patch.dict("os.environ", {"GEMINI_API_KEY": "clave-de-prueba"}), \
         patch("urllib.request.urlopen", return_value=_respuesta_gemini(f"```yaml\n{yaml_valido}```")):
        spec = traducir_con_ia("Pacto Histórico se fortalece")
    assert spec["id"] == "x"


def test_traducir_con_ia_reintenta_si_el_primer_yaml_no_valida():
    invalido = "id: x\nnombre: X\ndescripcion: prueba\ntransferencia:\n  alianza_verde:\n    alianza_verde: 0.5\n"  # suma 0.5, no 1.0
    valido = "id: x\nnombre: X\ndescripcion: prueba\ntransferencia:\n  alianza_verde:\n    alianza_verde: 1.0\n"
    with patch.dict("os.environ", {"GEMINI_API_KEY": "clave-de-prueba"}), \
         patch("urllib.request.urlopen", side_effect=[_respuesta_gemini(invalido), _respuesta_gemini(valido)]) as mock_urlopen:
        spec = traducir_con_ia("Alianza Verde se mantiene igual")
    assert spec["id"] == "x"
    assert mock_urlopen.call_count == 2  # el segundo intento le llevó el error de vuelta al modelo


def test_traducir_con_ia_se_rinde_tras_agotar_reintentos():
    invalido = "id: x\nnombre: X\ndescripcion: prueba\ntransferencia:\n  alianza_verde:\n    alianza_verde: 0.5\n"
    with patch.dict("os.environ", {"GEMINI_API_KEY": "clave-de-prueba"}), \
         patch("urllib.request.urlopen", side_effect=lambda *a, **k: _respuesta_gemini(invalido)), \
         pytest.raises(ValueError, match="no produjo un spec válido"):
        traducir_con_ia("hipótesis", max_reintentos=1)
