from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.recipe import (
    IngredientLink, RecipeCreate, RecipeIngredientCreate, RecipeStepCreate, RecipeUpdate,
)
from database.connection import get_db, rows_to_list, row_to_dict, generate_code, ensure_recipes_schema
from routers.auth import get_current_user
from services import sync_service
from services.recipe_formula import (
    canonical_stage,
    decorate_ingredient,
    dose_basis_of,
    process_path_label,
    stages_for_fiber,
    unit_for_basis,
)
import json
import random

router = APIRouter(prefix="/recipes", tags=["recipes"])

STATUS_TO_DB = {
    "active": ("active", 1),
    "inactive": ("active", 0),
    "development": ("draft", 0),
    "discarded": ("archived", 0),
    "draft": ("draft", 1),
    "archived": ("archived", 0),
}

STATUS_FILTER_SQL = {
    "active": " AND r.status = 'active' AND r.is_active = 1",
    "inactive": " AND r.status = 'active' AND r.is_active = 0",
    "development": " AND r.status = 'draft'",
    "draft": " AND r.status = 'draft'",
    "discarded": " AND r.status = 'archived'",
    "archived": " AND r.status = 'archived'",
}


def user_is_admin(user: dict) -> bool:
    perms = user.get("permissions") or "[]"
    if isinstance(perms, str):
        try:
            perms = json.loads(perms)
        except json.JSONDecodeError:
            perms = []
    return "*" in (perms or [])


def recipe_lifecycle(row: dict) -> str:
    status = row.get("status") or "active"
    active = int(row.get("is_active") or 0)
    if status == "archived":
        return "discarded"
    if status == "draft":
        return "development"
    if not active:
        return "inactive"
    return "active"


def decorate_recipe(row: dict | None) -> dict | None:
    if not row:
        return row
    row["lifecycle"] = recipe_lifecycle(row)
    row["process_stages"] = list(
        stages_for_fiber(row.get("fiber_type"), row.get("color_depth"), row.get("process_route"))
    )
    row["process_path_label"] = process_path_label(
        row.get("fiber_type"), row.get("color_depth"), row.get("process_route")
    )
    return row


def _ing_dict(ing) -> dict:
    if hasattr(ing, "model_dump"):
        return ing.model_dump()
    return dict(ing)


def _insert_step(conn, recipe_id: int, step) -> None:
    data = step.model_dump() if hasattr(step, "model_dump") else dict(step)
    stage = canonical_stage(data.get("bath_stage") or data.get("notes"))
    conn.execute(
        """INSERT INTO recipe_steps
           (recipe_id, step_order, step_name, step_type, duration_min, temperature_c,
            ph_target, notes, bath_stage)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            recipe_id,
            data.get("step_order"),
            data.get("step_name"),
            data.get("step_type") or "otros",
            data.get("duration_min"),
            data.get("temperature_c"),
            data.get("ph_target"),
            data.get("notes") or stage,
            stage,
        ),
    )


TEMP_NOTE = "Producto temporal de fórmula"


def _is_temp_code(code) -> bool:
    return str(code or "").startswith("TMP")


def _resolve_chemical(conn, recipe_id: int, data: dict, user_id: int | None) -> int:
    """Producto real, o uno temporal sin inventario para seguir la fórmula."""
    chem_id = data.get("chemical_id")
    temp_name = str(data.get("temp_name") or "").strip().upper()
    if chem_id:
        row = conn.execute(
            "SELECT id, code FROM chemicals WHERE id = ? AND deleted_at IS NULL",
            (chem_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="El producto de inventario no existe")
        if temp_name and _is_temp_code(row["code"]):
            conn.execute(
                "UPDATE chemicals SET name = ?, updated_at = datetime('now') WHERE id = ?",
                (temp_name, chem_id),
            )
        return int(chem_id)
    if not temp_name:
        raise HTTPException(status_code=400, detail="Indica el producto o un nombre temporal")
    code = f"TMP{recipe_id}{int(data.get('sort_order') or 0)}{random.randint(10000, 99999)}"
    conn.execute(
        """INSERT INTO chemicals
           (name, code, chemical_type, unit, stock_quantity, procurement_status, created_by, notes)
           VALUES (?, ?, 'otros', 'kg', 0, 'disponible', ?, ?)""",
        (temp_name, code, user_id, TEMP_NOTE),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


def _retire_unused_temps(conn) -> None:
    conn.execute(
        """UPDATE chemicals
           SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
           WHERE code LIKE 'TMP%'
             AND notes = ?
             AND deleted_at IS NULL
             AND id NOT IN (
               SELECT chemical_id FROM recipe_ingredients WHERE chemical_id IS NOT NULL
             )""",
        (TEMP_NOTE,),
    )


def _insert_ingredient(conn, recipe_id: int, ing, user_id: int | None = None) -> None:
    data = _ing_dict(ing)
    basis = dose_basis_of(data)
    unit = unit_for_basis(basis, data.get("unit") or "g")
    stage = canonical_stage(data.get("bath_stage") or data.get("notes"))
    chem_id = _resolve_chemical(conn, recipe_id, data, user_id)
    conn.execute(
        """INSERT INTO recipe_ingredients
           (recipe_id, step_id, chemical_id, quantity_per_kg, unit, dose_basis,
            tolerance_percentage, is_critical, sort_order, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            recipe_id,
            data.get("step_id"),
            chem_id,
            data["quantity_per_kg"],
            unit,
            basis,
            data.get("tolerance_percentage") or 5,
            data.get("is_critical") or 0,
            data.get("sort_order") or 0,
            stage,
        ),
    )


def apply_status_fields(data: dict, current_user: dict, *, force: bool = False) -> None:
    if "status" not in data:
        return
    if not force and not user_is_admin(current_user):
        data.pop("status", None)
        return
    mapped = STATUS_TO_DB.get(data["status"])
    if not mapped:
        raise HTTPException(status_code=400, detail="Estado de receta no válido")
    data["status"], data["is_active"] = mapped


@router.get("")
def list_recipes(
    search:     Optional[str] = Query(None),
    fiber_type: Optional[str] = Query(None),
    status:     Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT r.*, u.username AS created_by_name
        FROM recipes r
        LEFT JOIN users u ON r.created_by = u.id
        WHERE r.deleted_at IS NULL
    """
    params: list = []

    if search:
        like = f"%{search}%"
        query += """ AND (r.name LIKE ? OR r.code LIKE ? OR r.color_name LIKE ?
                         OR r.color_reference LIKE ? OR IFNULL(r.yarn_title,'') LIKE ?
                         OR IFNULL(r.commercial_ref,'') LIKE ?)"""
        params += [like, like, like, like, like, like]
    if fiber_type:
        query += " AND r.fiber_type = ?"
        params.append(fiber_type)
    if status:
        extra = STATUS_FILTER_SQL.get(status)
        if extra:
            query += extra

    query += " ORDER BY r.code"

    with get_db() as conn:
        ensure_recipes_schema(conn)
        rows = conn.execute(query, params).fetchall()
        recipes = rows_to_list(rows)
        if not recipes:
            return recipes
        ids = [r["id"] for r in recipes]
        placeholders = ",".join("?" * len(ids))
        ings = rows_to_list(
            conn.execute(
                f"""SELECT ri.*, c.name AS chemical_name, c.code AS chemical_code, c.unit AS chemical_unit,
                           c.chemical_type
                    FROM recipe_ingredients ri
                    JOIN chemicals c ON ri.chemical_id = c.id
                    WHERE ri.recipe_id IN ({placeholders})
                    ORDER BY ri.sort_order, ri.id""",
                ids,
            ).fetchall()
        )
    by_recipe: dict[int, list] = {}
    for ing in ings:
        decorate_ingredient(ing)
        by_recipe.setdefault(ing["recipe_id"], []).append(ing)
    for recipe in recipes:
        recipe["ingredients"] = by_recipe.get(recipe["id"], [])
        decorate_recipe(recipe)
    return recipes


@router.get("/{recipe_id}")
def get_recipe(recipe_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        ensure_recipes_schema(conn)
        row = conn.execute(
            """SELECT r.*, u.username AS created_by_name
               FROM recipes r LEFT JOIN users u ON r.created_by = u.id
               WHERE r.id = ? AND r.deleted_at IS NULL""",
            (recipe_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Receta no encontrada")

        steps = rows_to_list(
            conn.execute(
                "SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY step_order",
                (recipe_id,),
            ).fetchall()
        )

        ingredients = rows_to_list(
            conn.execute(
                """SELECT ri.*, c.name AS chemical_name, c.code AS chemical_code, c.unit AS chemical_unit,
                          c.chemical_type
                   FROM recipe_ingredients ri
                   JOIN chemicals c ON ri.chemical_id = c.id
                   WHERE ri.recipe_id = ?
                   ORDER BY ri.sort_order, ri.id""",
                (recipe_id,),
            ).fetchall()
        )

    recipe = decorate_recipe(row_to_dict(row))
    recipe["steps"] = steps
    recipe["ingredients"] = ingredients
    for ing in recipe["ingredients"]:
        decorate_ingredient(ing)
    return recipe


@router.post("", status_code=201)
def create_recipe(req: RecipeCreate, current_user: dict = Depends(get_current_user)):
    code = req.code or generate_code("recipe")
    status_payload = {"status": req.status or "development"}
    apply_status_fields(status_payload, current_user, force=user_is_admin(current_user))
    db_status, db_active = status_payload.get("status", "draft"), status_payload.get("is_active", 1)
    if not user_is_admin(current_user):
        db_status, db_active = "draft", 0

    with get_db() as conn:
        ensure_recipes_schema(conn)
        if conn.execute("SELECT id FROM recipes WHERE code = ?", (code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"El codigo '{code}' ya existe")

        conn.execute(
            """INSERT INTO recipes
               (code, name, fiber_type, color_reference, color_name, yarn_title, commercial_ref,
                color_depth, process_route, target_color_hex, bath_ratio_l_per_kg, temperature_c,
                process_time_min, yield_percentage, status, notes, created_by, is_active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                code, req.name, req.fiber_type, req.color_reference, req.color_name,
                req.yarn_title, req.commercial_ref, req.color_depth, req.process_route,
                req.target_color_hex, req.bath_ratio_l_per_kg, req.temperature_c,
                req.process_time_min, req.yield_percentage, db_status, req.notes,
                current_user["id"], db_active,
            ),
        )
        recipe_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        for step in req.steps:
            _insert_step(conn, recipe_id, step)

        for ing in req.ingredients:
            _insert_ingredient(conn, recipe_id, ing, current_user["id"])
        _retire_unused_temps(conn)

        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()

    recipe = decorate_recipe(row_to_dict(row))
    sync_service.enqueue("recipe", recipe_id, "create", recipe)
    return recipe


@router.put("/{recipe_id}")
def update_recipe(recipe_id: int, req: RecipeUpdate, current_user: dict = Depends(get_current_user)):
    data = req.model_dump(exclude_unset=True)
    steps = data.pop("steps", None)
    ingredients = data.pop("ingredients", None)
    apply_status_fields(data, current_user)

    with get_db() as conn:
        ensure_recipes_schema(conn)
        exists = conn.execute(
            "SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Receta no encontrada")

        if data:
            set_clause = ", ".join(f"{k} = ?" for k in data)
            values = list(data.values()) + [recipe_id]
            conn.execute(
                f"UPDATE recipes SET {set_clause}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
                values,
            )
        else:
            conn.execute(
                "UPDATE recipes SET updated_at = datetime('now') WHERE id = ?",
                (recipe_id,),
            )

        if steps is not None or ingredients is not None:
            conn.execute("DELETE FROM recipe_ingredients WHERE recipe_id = ?", (recipe_id,))
            conn.execute("DELETE FROM recipe_steps WHERE recipe_id = ?", (recipe_id,))
            for step in steps or []:
                _insert_step(conn, recipe_id, step)
            for ing in ingredients or []:
                _insert_ingredient(conn, recipe_id, ing, current_user["id"])
            _retire_unused_temps(conn)

        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()

    recipe = decorate_recipe(row_to_dict(row))
    sync_service.enqueue("recipe", recipe_id, "update", recipe)
    return recipe


@router.delete("/{recipe_id}")
def delete_recipe(recipe_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Receta no encontrada")

        in_use = conn.execute(
            "SELECT id FROM processes WHERE recipe_id = ? AND status IN ('pending','in_progress','paused')",
            (recipe_id,),
        ).fetchone()
        if in_use:
            raise HTTPException(status_code=409, detail="La receta tiene procesos activos y no puede eliminarse")

        conn.execute(
            "UPDATE recipes SET deleted_at = datetime('now'), updated_at = datetime('now'), is_active = 0 WHERE id = ?",
            (recipe_id,),
        )
    sync_service.enqueue("recipe", recipe_id, "delete", {"id": recipe_id})
    return {"message": "Receta eliminada"}


@router.post("/{recipe_id}/copy", status_code=201)
def copy_recipe(recipe_id: int, current_user: dict = Depends(get_current_user)):
    """Clona fórmula, pasos e ingredientes. Nuevo código; el usuario cambia títulos."""
    src = get_recipe(recipe_id, current_user)
    code = generate_code("recipe")
    name = str(src.get("name") or "Receta").strip()
    copy_name = name if name.endswith("(copia)") else f"{name} (copia)"
    status_payload = {"status": "development"}
    apply_status_fields(status_payload, current_user, force=True)
    db_status, db_active = status_payload["status"], status_payload["is_active"]

    with get_db() as conn:
        ensure_recipes_schema(conn)
        if conn.execute("SELECT id FROM recipes WHERE code = ?", (code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"El codigo '{code}' ya existe")
        conn.execute(
            """INSERT INTO recipes
               (code, name, fiber_type, color_reference, color_name, yarn_title, commercial_ref,
                color_depth, process_route, target_color_hex, bath_ratio_l_per_kg, temperature_c,
                process_time_min, yield_percentage, status, notes, created_by, is_active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                code, copy_name, src.get("fiber_type"), src.get("color_reference"),
                src.get("color_name"), src.get("yarn_title"), src.get("commercial_ref"),
                src.get("color_depth"), src.get("process_route"), src.get("target_color_hex"),
                src.get("bath_ratio_l_per_kg"), src.get("temperature_c"),
                src.get("process_time_min"), src.get("yield_percentage") or 100,
                db_status, src.get("notes"), current_user["id"], db_active,
            ),
        )
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for step in src.get("steps") or []:
            _insert_step(conn, new_id, step)
        for idx, ing in enumerate(src.get("ingredients") or []):
            payload = dict(ing)
            payload["sort_order"] = payload.get("sort_order") if payload.get("sort_order") is not None else idx
            payload["step_id"] = None
            if int(payload.get("is_temporary") or 0) == 1:
                payload["temp_name"] = payload.get("chemical_name") or payload.get("temp_name")
                payload["chemical_id"] = None
            _insert_ingredient(conn, new_id, payload, current_user["id"])

    copied = get_recipe(new_id, current_user)
    sync_service.enqueue("recipe", new_id, "create", copied)
    return copied


# ---------------------------------------------------------------------------
# Pasos e ingredientes individuales
# ---------------------------------------------------------------------------

@router.post("/{recipe_id}/steps", status_code=201)
def add_step(recipe_id: int, req: RecipeStepCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Receta no encontrada")
        ensure_recipes_schema(conn)
        _insert_step(conn, recipe_id, req)
        step_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT * FROM recipe_steps WHERE id = ?", (step_id,)).fetchone()
    return row_to_dict(row)


@router.delete("/{recipe_id}/steps/{step_id}")
def delete_step(recipe_id: int, step_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM recipe_steps WHERE id = ? AND recipe_id = ?", (step_id, recipe_id)
        )
    return {"message": "Paso eliminado"}


@router.post("/{recipe_id}/ingredients/{ingredient_id}/link")
def link_ingredient(
    recipe_id: int,
    ingredient_id: int,
    req: IngredientLink,
    current_user: dict = Depends(get_current_user),
):
    """Asocia un producto temporal con el ítem real de inventario."""
    with get_db() as conn:
        ensure_recipes_schema(conn)
        ing = conn.execute(
            """SELECT ri.id, ri.chemical_id
               FROM recipe_ingredients ri
               WHERE ri.id = ? AND ri.recipe_id = ?""",
            (ingredient_id, recipe_id),
        ).fetchone()
        if not ing:
            raise HTTPException(status_code=404, detail="Producto de la receta no encontrado")
        chem = conn.execute(
            """SELECT id, name FROM chemicals
               WHERE id = ? AND deleted_at IS NULL AND code NOT LIKE 'TMP%'""",
            (req.chemical_id,),
        ).fetchone()
        if not chem:
            raise HTTPException(status_code=400, detail="Elige un producto que ya esté en inventario")
        conn.execute(
            "UPDATE recipe_ingredients SET chemical_id = ? WHERE id = ?",
            (req.chemical_id, ingredient_id),
        )
        _retire_unused_temps(conn)
    return get_recipe(recipe_id, current_user)


@router.post("/{recipe_id}/ingredients", status_code=201)
def add_ingredient(recipe_id: int, req: RecipeIngredientCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Receta no encontrada")
        ensure_recipes_schema(conn)
        _insert_ingredient(conn, recipe_id, req, current_user["id"])
        ing_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute(
            """SELECT ri.*, c.name AS chemical_name
               FROM recipe_ingredients ri JOIN chemicals c ON ri.chemical_id = c.id
               WHERE ri.id = ?""",
            (ing_id,),
        ).fetchone()
    return row_to_dict(row)


@router.delete("/{recipe_id}/ingredients/{ingredient_id}")
def delete_ingredient(recipe_id: int, ingredient_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM recipe_ingredients WHERE id = ? AND recipe_id = ?",
            (ingredient_id, recipe_id),
        )
    return {"message": "Ingrediente eliminado"}
