"""Infiere el tipo de tintorería a partir del nombre. Conservador: si no es claro, Otros."""

from __future__ import annotations

import re
import unicodedata

VALID_TYPES = {
    "acido", "reactivo", "directo", "auxiliar",
    "mordiente", "disperso", "vat", "blanqueador", "otros",
}

# Primero clases de colorante / blanqueo / mordiente; después auxiliares de proceso.
# No usar "ACIDO" suelto: ácido acético/fórmico son auxiliares, no colorante ácido.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("reactivo", (
        "REACTIVO", "REACTIVOS", "BEZAKTIV", "REMAZOL", "LEVAFIX",
        "CIBACRON", "DRIMARENE", "NOVACRON", "PROCION", "AVITERA",
    )),
    ("disperso", (
        "DISPERSO", "DISPERSOS", "TERASIL", "FORON", "PALANIL", "DISPERSOL", "SERILENE",
    )),
    ("directo", (
        "COLORANTE DIRECTO", "DIRECTOS", "DIRECTO",
    )),
    ("vat", (
        "COLORANTE VAT", "COLORANTE CUBO", "INDANTHREN", "INDANTHRENE",
        "PALANTHRENE", "VAT", "CUBO",
    )),
    ("mordiente", (
        "MORDIENTE", "MORDIENTES", "ALUMBRE", "DICROMATO",
    )),
    ("blanqueador", (
        "BLANQUEADOR", "BLANQUEADORES", "BLANQUEANTE", "PEROXIDO",
        "HIPOCLORITO", "CLORITO", "CASDIWHITE", "COTOBLANC",
        "ABRILLANTADOR OPTICO", "OPTICO",
    )),
    ("acido", (
        "COLORANTE ACIDO", "COLORANTES ACIDOS", "NYLOSAN", "TELON",
        "LANASOL", "ERIONYL", "SUPRANOL",
    )),
    ("auxiliar", (
        "SULFATO", "BISULFITO", "METABISULFITO", "HIDROSULFITO",
        "CARBONATO", "CAUSTICA", "HIDROXIDO", "SOSA", "SODA",
        "IGUALADOR", "SUAVIZANTE", "LUBRICANTE", "LUBRIFIL", "CECOLUBE",
        "CATALASA", "CATALASE", "POLYQUEST", "SEQUESTRANTE",
        "HUMECTANTE", "ANTIESPUMANTE", "ANTIESPUMA", "DETERGENTE",
        "ENZIMA", "AMILASA", "FIJADOR", "NEARFIX", "NEARACID", "DISPERSANTE",
        "ACETICO", "FORMICO", "GLAUBER", "SILICATO", "METASILICATO",
        "CLORURO DE SODIO", "SAL DE GLAUBER", "ELECTROLITO",
        "ACIDO ACETICO", "ACIDO FORMICO", "ACIDO SULFURICO", "ACIDO CLORHIDRICO",
    )),
]


def _norm(text: str) -> str:
    raw = unicodedata.normalize("NFKD", text or "")
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"[^A-Z0-9]+", " ", raw.upper()).strip()


def infer_chemical_type(*parts: str) -> str:
    """Devuelve un tipo del catalogo. Si no hay pista clara, 'otros'."""
    norm = _norm(" ".join(part for part in parts if part))
    if not norm:
        return "otros"
    tokens = set(norm.split())
    padded = f" {norm} "
    for tipo, phrases in _RULES:
        for phrase in phrases:
            if " " in phrase:
                if f" {phrase} " in padded:
                    return tipo
            elif phrase in tokens:
                return tipo
    return "otros"


def resolved_type(name: str, current: str | None = None, *extra: str) -> str:
    """No pisa un tipo ya elegido a mano; sí sale de Otros si el nombre es claro."""
    status = (current or "otros").strip().lower()
    if status not in VALID_TYPES:
        status = "otros"
    inferred = infer_chemical_type(name, *extra)
    if status in ("", "otros") and inferred != "otros":
        return inferred
    return status or "otros"


def reclassify_otros(conn) -> int:
    """Actualiza químicos que siguen en Otros si el nombre ya indica el tipo."""
    rows = conn.execute(
        """SELECT id, name FROM chemicals
           WHERE deleted_at IS NULL
             AND (chemical_type IS NULL OR chemical_type = '' OR chemical_type = 'otros')"""
    ).fetchall()
    updated = 0
    for row in rows:
        inferred = infer_chemical_type(row["name"] if "name" in row else row[1])
        if inferred == "otros":
            continue
        chem_id = row["id"] if "id" in row else row[0]
        conn.execute(
            """UPDATE chemicals
               SET chemical_type = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (inferred, chem_id),
        )
        updated += 1
    return updated
