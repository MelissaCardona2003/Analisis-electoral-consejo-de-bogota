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
