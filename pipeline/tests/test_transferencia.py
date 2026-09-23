import numpy as np
import pandas as pd
import pytest

from pipeline import config as C
from pipeline.transferencia import CATEGORIAS, _matriz_puesto_categoria, ajustar_transferencia, preparar_par, resumen_matriz


def _cat_sintetico() -> pd.DataFrame:
    """Un puesto especial (excluido) + tres puestos normales, en dos elecciones, con las 10 categorías."""
    filas = []
    for eleccion, base in [("origen_test", 100), ("destino_test", 100)]:
        for puesto, loc in [("0101", 1), ("0102", 1), ("0203", 2), ("9001", 90)]:
            for i, cat in enumerate(CATEGORIAS):
                filas.append({"eleccion": eleccion, "puesto_id": puesto, "categoria": cat,
                              "votos": base + i * 10 + (5 if eleccion == "destino_test" else 0),
                              "localidad_cod": loc})
    return pd.DataFrame(filas)


def test_matriz_puesto_categoria_excluye_especiales_y_ordena_columnas():
    cat = _cat_sintetico()
    p = _matriz_puesto_categoria(cat, "origen_test")
    assert "9001" not in p.index  # localidad 90 (censo/Corferias) excluida, igual que en aggregate.py
    assert list(p.columns) == CATEGORIAS  # orden fijo, no el orden de aparición en los datos


def test_preparar_par_solo_puestos_comunes_con_votos_en_ambos_lados():
    cat = _cat_sintetico()
    R, Cc, puestos = preparar_par(cat, "origen_test", "destino_test")
    assert sorted(puestos) == ["0101", "0102", "0203"]
    assert R.shape == (3, len(CATEGORIAS))
    assert Cc.shape == (3, len(CATEGORIAS))
    assert (R.sum(axis=1) > 0).all() and (Cc.sum(axis=1) > 0).all()


@pytest.mark.slow
def test_ajustar_transferencia_conserva_masa_y_converge_en_caso_juguete():
    """Modelo diminuto (K=3, pocos puestos) solo para validar la mecánica: filas de T suman 1."""
    rng = np.random.default_rng(0)
    K = 3
    T_real = np.array([[0.7, 0.2, 0.1], [0.1, 0.8, 0.1], [0.2, 0.2, 0.6]])
    n_puestos = 60
    R = rng.multinomial(500, rng.dirichlet(np.ones(K) * 2, size=n_puestos))
    Cc = np.array([rng.multinomial(int(r.sum()), (r / r.sum()) @ T_real) for r in R])

    categorias = ["a", "b", "c"]
    idata = ajustar_transferencia(R, Cc, categorias=categorias, draws=200, tune=200, chains=2)
    resumen = resumen_matriz(idata, categorias=categorias)

    media = np.array(resumen["media"])
    assert media.shape == (K, K)
    # conservación de masa por construcción (Dirichlet); tolerancia acorde al round(4) de resumen_matriz
    np.testing.assert_allclose(media.sum(axis=1), 1.0, atol=1e-3)
    # con una señal de mezcla fuerte y datos limpios, la media posterior debería acercarse al T real
    assert np.abs(media - T_real).max() < 0.15


def test_especiales_compartido_con_analysis():
    # ESPECIALES vive en config.py y lo usan tanto aggregate.py (edades, ver Fase 1) como transferencia.py
    assert C.ESPECIALES == {90, 98}
