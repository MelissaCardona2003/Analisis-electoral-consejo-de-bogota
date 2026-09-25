import numpy as np
from scipy import stats

from pipeline.model import calibrar_escala, inv_logit, logit


def test_calibrar_escala_nunca_reduce_por_debajo_de_uno():
    # residuos pequeños respecto a la escala: la t ya cubre de sobra, no hay motivo para ensanchar
    nu, escala = 5.0, 1.0
    mu = np.zeros(10)
    resid_pequenos = np.full(10, 0.05)  # muy por debajo de lo que pediría un intervalo del 80%
    real = inv_logit(mu + resid_pequenos)
    factor = calibrar_escala(real, mu, nu, escala, nivel=0.8)
    assert factor == 1.0


def test_calibrar_escala_ensancha_cuando_hay_subcobertura():
    # residuos grandes: la t actual se queda corta, el factor debe ser > 1
    nu, escala = 5.0, 0.3
    mu = np.zeros(10)
    resid_grandes = np.full(10, 2.0)  # mucho más ancho que un intervalo del 80% con escala=0.3
    real = inv_logit(mu + resid_grandes)
    factor = calibrar_escala(real, mu, nu, escala, nivel=0.8)
    assert factor > 1.0


def test_calibrar_escala_logra_cobertura_nominal_por_construccion():
    # la propiedad central: tras aplicar el factor, ~80% de las categorías caen dentro del intervalo
    # calibrado al 80% — no solo "se ensancha algo", sino que apunta exactamente al nivel pedido.
    rng = np.random.default_rng(0)
    nu, escala_base = 8.0, 0.25  # escala deliberadamente angosta para forzar sub-cobertura inicial
    n = 200
    mu = np.zeros(n)
    resid_real = stats.t.rvs(4, scale=0.6, size=n, random_state=rng)  # colas más pesadas que la escala base
    real = inv_logit(mu + resid_real)

    factor = calibrar_escala(real, mu, nu, escala_base, nivel=0.8)
    escala_calibrada = escala_base * factor

    q80 = stats.t.ppf(0.9, nu) * escala_calibrada
    cobertura = np.mean(np.abs(logit(real) - mu) <= q80)
    assert 0.75 <= cobertura <= 0.85  # cerca de 80%, con margen por ser una muestra finita


def test_calibrar_escala_tambien_calibra_al_95():
    # cada nivel se calibra de forma independiente contra su propio cuantil nominal — no hay garantía
    # de que el factor al 95% sea mayor que al 80% (depende de qué tan bien la forma real de los
    # residuos coincide con la t(nu) asumida en cada cola); lo que sí debe cumplirse siempre es que,
    # aplicado, cada uno acerque la cobertura empírica a su propio nivel pedido.
    rng = np.random.default_rng(1)
    nu, escala_base = 6.0, 0.3
    n = 300
    mu = np.zeros(n)
    resid_real = stats.t.rvs(4, scale=0.5, size=n, random_state=rng)
    real = inv_logit(mu + resid_real)

    f95 = calibrar_escala(real, mu, nu, escala_base, nivel=0.95)
    assert f95 >= 1.0
    q95 = stats.t.ppf(0.975, nu) * escala_base * f95
    cobertura_95 = np.mean(np.abs(logit(real) - mu) <= q95)
    assert 0.90 <= cobertura_95 <= 0.99


def test_cobertura_analitica_coincide_con_conteo_directo_y_no_usa_aleatorios():
    from pipeline.model import cobertura_analitica

    nu, escala = 5.0, 0.4
    mu = np.zeros(10)
    # 5 residuos por debajo del cuantil del 80% y 5 muy por encima → cobertura exactamente 0.5
    q80 = stats.t.ppf(0.9, nu) * escala
    resid = np.array([0.1 * q80] * 5 + [3.0 * q80] * 5)
    real = inv_logit(mu + resid)
    assert cobertura_analitica(real, mu, nu, escala, nivel=0.8) == 0.5
    # es determinista: mismo resultado en llamadas repetidas
    assert cobertura_analitica(real, mu, nu, escala, nivel=0.8) == cobertura_analitica(real, mu, nu, escala, nivel=0.8)


def test_calibracion_lleva_cobertura_analitica_al_nivel_pedido():
    from pipeline.model import cobertura_analitica

    rng = np.random.default_rng(3)
    nu, escala = 8.0, 0.2
    n = 400
    mu = np.zeros(n)
    real = inv_logit(mu + stats.t.rvs(4, scale=0.6, size=n, random_state=rng))
    antes = cobertura_analitica(real, mu, nu, escala, 0.8)
    factor = calibrar_escala(real, mu, nu, escala, 0.8)
    despues = cobertura_analitica(real, mu, nu, escala * factor, 0.8)
    assert antes < 0.8  # el intervalo original se quedaba corto
    assert 0.75 <= despues <= 0.85


def _tabla_toy():
    import pandas as pd

    from pipeline.model import CATS

    filas = {
        "concejo_2019": np.linspace(1, 2, len(CATS)), "camara_2018": np.linspace(2, 1, len(CATS)),
        "camara_2022": np.linspace(1.5, 1.5, len(CATS)), "presidente_2018": np.linspace(3, 1, len(CATS)),
        "presidente_2022": np.linspace(1, 3, len(CATS)),
    }
    S = pd.DataFrame({k: v / v.sum() for k, v in filas.items()}, index=CATS).T
    kappa = {"kappa_mco": 0.5, "familias": []}
    return S, kappa, len(CATS)


def test_regla_presidencial_aplica_el_puente_a_la_presidencial_reciente_no_al_concejo_anterior():
    from pipeline.model import CATS, centro_matriz, centros

    S, kappa, K = _tabla_toy()
    T = np.full((K, K), 1 / K)
    T[0] = np.eye(K)[0]  # la primera categoría se queda entera; las demás reparten parejo
    out = centros(S, "concejo_2019", "camara_2018", "camara_2022", kappa, matriz_pres=T, pres_ref="presidente_2022")
    esperado = centro_matriz(S.loc["presidente_2022", CATS].values.astype(float), T)
    assert np.allclose(out["transferencia_matriz_presidencial"], esperado)
    # y NO es el puente aplicado al Concejo anterior (el diseño que se retiró)
    equivocado = centro_matriz(S.loc["concejo_2019", CATS].values.astype(float), T)
    assert not np.allclose(out["transferencia_matriz_presidencial"], equivocado)


def test_regla_presidencial_exige_la_presidencial_de_referencia_y_no_altera_las_demas_reglas():
    import pytest

    from pipeline.model import centros

    S, kappa, K = _tabla_toy()
    T = np.full((K, K), 1 / K)
    with pytest.raises(ValueError):
        centros(S, "concejo_2019", "camara_2018", "camara_2022", kappa, matriz_pres=T)
    base = centros(S, "concejo_2019", "camara_2018", "camara_2022", kappa)
    con = centros(S, "concejo_2019", "camara_2018", "camara_2022", kappa, matriz_pres=T, pres_ref="presidente_2022")
    for regla in base:  # añadir la regla presidencial no toca ninguna de las existentes
        assert np.array_equal(base[regla], con[regla])
    assert "transferencia_matriz_presidencial" in con and "transferencia_matriz_presidencial" not in base
