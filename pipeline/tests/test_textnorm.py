from pipeline.textnorm import (SpaceRepairer, normalize_text, parse_localidad_codigo, text_key,
                               title_case_es)

NBSP, ZWSP, BOM = chr(0xA0), chr(0x200B), chr(0xFEFF)


def test_mojibake_se_repara():
    assert normalize_text("USAQUÃ‰N") == "USAQUÉN"
    assert normalize_text("MIGUEL URIBE LONDOÃ‘O") == "MIGUEL URIBE LONDOÑO"
    assert normalize_text("PEÑA") == "PEÑA"


def test_espacios_e_invisibles():
    assert normalize_text(f"  LOCALIDAD  8{NBSP}KENNEDY{ZWSP} ") == "LOCALIDAD 8 KENNEDY"
    assert normalize_text(f"{BOM}PARTIDO POLITICO  MIRA") == "PARTIDO POLITICO MIRA"
    assert normalize_text(f"UNO{chr(0)}DOS") == "UNO DOS"


def test_llave_ignora_tildes_y_enie():
    assert text_key("ANDRES DARIO ONZAGA NIÑO") == text_key("ANDRES DARIO ONZAGA NINO")
    assert text_key("PARTIDO CENTRO DEMOCRÁTICO") == text_key("PARTIDO CENTRO DEMOCRATICO")


def test_localidad_desde_comuna():
    assert parse_localidad_codigo("01LOCALIDAD 1 USAQUEN") == 1
    assert parse_localidad_codigo("LOCALIDAD  8 KENNEDY") == 8
    assert parse_localidad_codigo("18LOCALIDAD 18 RAFAEL URIBE URIB") == 18
    assert parse_localidad_codigo("NACIONAL") is None


def test_title_case():
    assert title_case_es("COLEGIO SAN JOSE DE LA SALLE") == "Colegio San Jose de la Salle"
    assert title_case_es("PUESTO CENSO(FERIA EXPOSICION)") == "Puesto Censo(Feria Exposicion)"


CORPUS = [
    'LIDERAZGO AMPLIO DE RENOVACIÓN AVANZADA DE BTÁ "LARA BOGOTÁ"', "LARA BOGOTÁ", "LIBARDO ASPRILLA LARA",
    "COLOMBIA JUSTA LIBRES", "PARTIDO COLOMBIA JUSTA LIBRES", "PARTIDO POLITICO MIRA", "PARTIDO POLÍTICO MIRA",
    "NUEVO LIBERALISMO EN MARCHA", "AGRUPACION POLITICA EN MARCHA", "PARTIDO DE LA U", "DE LA U",
    "MARIA DE LA CRUZ", "PARTIDO DEL TRABAJO", "BOGOTÁ", "PARTIDO",
    "EL MAR", "MAR ABIERTO", "SOMBRERO CHARRO", "CHARRO NEGRO",
]


def test_reparacion_de_espacios_rotos():
    r = SpaceRepairer(CORPUS)
    assert r.repair('DE BTÁ "LA RA BOGOTÁ"') == 'DE BTÁ "LARA BOGOTÁ"'
    assert r.repair("COLOMBIA JUSTA L IBRES") == "COLOMBIA JUSTA LIBRES"
    assert r.repair("PARTIDO POL ITICO MIRA") == "PARTIDO POLITICO MIRA"
    assert r.repair("EN M ARCHA") == "EN MARCHA"
    assert r.repair("COLOMBIA JUS TA LIBRES") == "COLOMBIA JUSTA LIBRES"


def test_reparacion_no_une_puntuacion():
    r = SpaceRepairer(CORPUS + ["COLEGIO DON BOSCO", "DON BOSCO", "IED", "SEDE IED"])
    assert r.repair("DON BOSCO - IED") == "DON BOSCO - IED"
    assert r.repair('MIRA "LARA "') == 'MIRA "LARA "'


def test_reparacion_no_toca_textos_sanos_y_marca_ambiguos():
    r = SpaceRepairer(CORPUS)
    assert r.repair("MARIA DE LA CRUZ") == "MARIA DE LA CRUZ"
    assert r.repair("PARTIDO DE LA U") == "PARTIDO DE LA U"
    # "DE L A U": las uniones posibles (DEL, LA) son demasiado cortas para ser concluyentes -> no se toca
    assert r.repair("CONSERVADOR DE L A U") == "CONSERVADOR DE L A U"
    # "CHA" podría pegarse a "MAR" (MARCHA) o a "RRO" (CHARRO): ambiguo -> se marca para revisión
    r.repair("EL MAR CHA RRO")
    assert "EL MAR CHA RRO" in r.flagged
