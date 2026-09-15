import numpy as np
import pytest

from pipeline.seats import cifra_repartidora, cifra_repartidora_lote


def test_dhondt_ejemplo_clasico():
    # Ejemplo de manual: 7 curules
    votos = {"A": 340_000, "B": 280_000, "C": 160_000, "D": 60_000}
    r = cifra_repartidora(votos, blancos=0, curules=7, umbral_fraccion=0.0)
    assert r.curules == {"A": 3, "B": 3, "C": 1, "D": 0}


def test_umbral_excluye_listas_pequenas():
    votos = {"A": 500, "B": 400, "C": 40}
    r = cifra_repartidora(votos, blancos=60, curules=10)
    # cociente = 1000/10 = 100; umbral = 50 -> C queda por fuera aunque D'Hondt le daría curul
    assert r.umbral == pytest.approx(50)
    assert r.curules["C"] == 0
    assert sum(r.curules.values()) == 10


def test_sensibilidad_ganar_curul():
    votos = {"A": 340_000, "B": 280_000, "C": 160_000, "D": 60_000}
    r = cifra_repartidora(votos, blancos=0, curules=7, umbral_fraccion=0.0)
    nuevo = dict(votos)
    nuevo["C"] += r.votos_para_otra_curul["C"]
    assert cifra_repartidora(nuevo, blancos=0, curules=7, umbral_fraccion=0.0).curules["C"] == 2


@pytest.mark.parametrize("anio", [2011, 2015])
def test_reproduce_concejos_historicos(anio):
    """2011 y 2015 (45 curules, sin curul de oposición) con los totales publicados."""
    import pandas as pd
    from pipeline import config as C

    h = pd.read_csv(C.REFERENCE / "concejo_historico.csv")
    h = h[h["anio"] == anio]
    listas = h[h["curules"].notna()]
    blancos = int(h.loc[h["lista"] == "blanco", "votos"].iat[0])
    r = cifra_repartidora(dict(zip(listas["lista"], listas["votos"])), blancos, curules=45)
    assert r.curules == dict(zip(listas["lista"], listas["curules"].astype(int)))


def test_reproduce_composicion_oficial_2019_2023():
    import pandas as pd
    from pipeline import config as C

    path = C.PROCESSED / "concejo_listas.csv"
    if not path.exists():
        pytest.skip("requiere correr pipeline.aggregate")
    L = pd.read_csv(path)
    for anio in C.YEARS:
        calc = {r.lista_id: r.curules_repartidora for r in L[L["anio"] == anio].itertuples() if r.curules_repartidora}
        assert calc == C.CURULES_OFICIALES[anio]["repartidora"]


def test_lote_coincide_con_escalar():
    rng = np.random.default_rng(1)
    V = rng.integers(1_000, 500_000, size=(200, 12))
    B = rng.integers(0, 300_000, size=200)
    lote = cifra_repartidora_lote(V, B, curules=44)
    for s in range(200):
        esc = cifra_repartidora({str(i): int(v) for i, v in enumerate(V[s])}, int(B[s]), curules=44)
        assert [esc.curules[str(i)] for i in range(12)] == lote[s].tolist()
