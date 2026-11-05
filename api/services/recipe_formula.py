"""Dosis de receta de laboratorio: % o.w.f. o g/L, liquidada al lote."""

from typing import Any, Mapping, Optional

PLANT_STAGES = (
    "preblanqueo",
    "descrude",
    "tenido",
    "reductivo",
    "jabonado",
    "fijado",
    "suavizado",
)

COLOR_DEPTHS = ("oscuros", "claros")
COTTON_ROUTES = ("preblanqueo", "descrude")

STAGE_ALIASES = {
    "preparacion": "preblanqueo",
    "tincion": "tenido",
    "fijacion": "fijado",
    "acabado": "suavizado",
}

DOSE_PERCENT = "percent"
DOSE_G_L = "g_l"
DOSE_PER_KG = "per_kg"


class FormulaError(ValueError):
    """Dosis incompleta o sin datos para liquidar."""


def canonical_stage(raw: Any) -> str:
    note = str(raw or "").strip().lower()
    if note in STAGE_ALIASES:
        return STAGE_ALIASES[note]
    if note in PLANT_STAGES:
        return note
    return "tenido"


def stages_for_fiber(
    fiber_type: Any = None,
    color_depth: Any = None,
    process_route: Any = None,
) -> tuple[str, ...]:
    """Etapas de la hoja según fibra, tono (acrílico) y ruta (algodón)."""
    fiber = str(fiber_type or "").strip().lower()
    depth = str(color_depth or "").strip().lower()
    route = str(process_route or "").strip().lower()
    if fiber == "acrilico":
        if depth == "claros":
            return ("tenido",)
        return ("tenido", "reductivo")
    if fiber == "algodon":
        start = route if route in COTTON_ROUTES else "preblanqueo"
        return (start, "tenido", "jabonado", "fijado", "suavizado")
    if fiber == "mezcla":
        return ("reductivo", "tenido", "jabonado", "fijado", "suavizado")
    return PLANT_STAGES


def process_path_label(
    fiber_type: Any = None,
    color_depth: Any = None,
    process_route: Any = None,
) -> str:
    fiber = str(fiber_type or "").strip().lower()
    if fiber == "acrilico":
        return "Claros" if str(color_depth or "").strip().lower() == "claros" else "Oscuros / medios"
    if fiber == "algodon":
        return "Descrude" if str(process_route or "").strip().lower() == "descrude" else "Preblanqueo"
    if fiber == "mezcla":
        return "Reductivo → teñido, jabonado, fijado, suavizado"
    return ""


def infer_dose_basis(unit: Any) -> str:
    u = str(unit or "").strip().lower().replace(" ", "")
    if u in ("%", "percent", "owf", "p/p"):
        return DOSE_PERCENT
    if u in ("g/l", "g_l", "gl", "gpl"):
        return DOSE_G_L
    return DOSE_PER_KG


def dose_basis_of(ing: Mapping[str, Any]) -> str:
    basis = str(ing.get("dose_basis") or "").strip()
    if basis in (DOSE_PERCENT, DOSE_G_L, DOSE_PER_KG):
        return basis
    return infer_dose_basis(ing.get("unit"))


def unit_for_basis(basis: str, fallback: Any = "g") -> str:
    if basis == DOSE_PERCENT:
        return "%"
    if basis == DOSE_G_L:
        return "g/L"
    return str(fallback or "g")


def decorate_ingredient(ing: dict) -> dict:
    note = ing.get("notes") or ing.get("bath_stage")
    ing["bath_stage"] = canonical_stage(note)
    basis = dose_basis_of(ing)
    ing["dose_basis"] = basis
    code = str(ing.get("chemical_code") or ing.get("code") or "")
    ing["is_temporary"] = 1 if code.startswith("TMP") else 0
    return ing


def machine_bath_ratio(machine: Optional[Mapping[str, Any]]) -> Optional[float]:
    if not machine:
        return None
    try:
        cap = float(machine.get("capacity_kg") or 0)
        water = float(machine.get("water_capacity_liters") or 0)
    except (TypeError, ValueError):
        return None
    if cap <= 0 or water <= 0:
        return None
    return water / cap


def liquidate_ingredient(
    ing: Mapping[str, Any],
    fiber_kg: float,
    bath_ratio: Optional[float],
) -> tuple[float, str]:
    """Devuelve (cantidad, unidad) para pesaje: g si es < 1 kg, si no kg."""
    value = float(ing.get("quantity_per_kg") or 0)
    fiber = float(fiber_kg or 0)
    basis = dose_basis_of(ing)
    name = ing.get("chemical_name") or "químico"
    unit_in = str(ing.get("unit") or "").strip().lower()

    if fiber <= 0:
        raise FormulaError("El peso de fibra del lote es obligatorio para liquidar la receta")

    if basis == DOSE_PERCENT or unit_in in ("%", "percent", "owf"):
        qty_kg = fiber * value / 100.0
    elif basis == DOSE_G_L or unit_in in ("g/l", "g_l", "gl"):
        if not bath_ratio or bath_ratio <= 0:
            raise FormulaError(
                f"{name}: dosis en g/L requiere relación de baño de la máquina o de la receta"
            )
        qty_kg = (value * float(bath_ratio) * fiber) / 1000.0
    elif unit_in in ("g", "gr", "gramos"):
        qty_kg = value * fiber / 1000.0
    elif unit_in in ("mg", "miligramos"):
        qty_kg = value * fiber / 1_000_000.0
    else:
        qty_kg = value * fiber

    if qty_kg < 0:
        qty_kg = 0.0
    if qty_kg < 1:
        return round(qty_kg * 1000.0, 3), "g"
    return round(qty_kg, 3), "kg"
