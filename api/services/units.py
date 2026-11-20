"""Conversión entre las unidades de stock y las del pesaje."""

IN_BASE = {"kg": 1.0, "g": 0.001, "L": 1.0, "mL": 0.001}


def _family(unit: str):
    if unit in ("kg", "g"):
        return "mass"
    if unit in ("L", "mL"):
        return "vol"
    return None


def convert_qty(qty: float, from_unit: str, to_unit: str):
    """Devuelve la cantidad en la unidad destino, o None si no son compatibles."""
    source = (from_unit or "").strip()
    target = (to_unit or "").strip()
    try:
        amount = float(qty)
    except (TypeError, ValueError):
        return None
    if source == target:
        return amount
    if not _family(source) or _family(source) != _family(target):
        return None
    return amount * IN_BASE[source] / IN_BASE[target]
