from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.recipe import RecipeCreate, RecipeUpdate, RecipeStepCreate, RecipeIngredientCreate
from database.connection import get_db, rows_to_list, row_to_dict, generate_code
from routers.auth import get_current_user
from services import sync_service

router = APIRouter(prefix="/recipes", tags=["recipes"])


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
        WHERE r.deleted_at IS NULL AND r.is_active = 1
    """
    params: list = []

    if search:
        query += " AND (r.name LIKE ? OR r.code LIKE ? OR r.color_name LIKE ?)"
        params += [f"%{search}%", f"%{search}%", f"%{search}%"]
    if fiber_type:
        query += " AND r.fiber_type = ?"
        params.append(fiber_type)
    if status:
        query += " AND r.status = ?"
        params.append(status)

    query += " ORDER BY r.code"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


@router.get("/{recipe_id}")
def get_recipe(recipe_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
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
                """SELECT ri.*, c.name AS chemical_name, c.code AS chemical_code, c.unit AS chemical_unit
                   FROM recipe_ingredients ri
                   JOIN chemicals c ON ri.chemical_id = c.id
                   WHERE ri.recipe_id = ?
                   ORDER BY ri.sort_order, ri.id""",
                (recipe_id,),
            ).fetchall()
        )

    recipe = row_to_dict(row)
    recipe["steps"] = steps
    recipe["ingredients"] = ingredients
    return recipe


@router.post("", status_code=201)
def create_recipe(req: RecipeCreate, current_user: dict = Depends(get_current_user)):
    code = req.code or generate_code("recipe")

    with get_db() as conn:
        if conn.execute("SELECT id FROM recipes WHERE code = ?", (code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"El codigo '{code}' ya existe")

        conn.execute(
            """INSERT INTO recipes
               (code, name, fiber_type, color_reference, color_name, target_color_hex,
                bath_ratio_l_per_kg, temperature_c, process_time_min, yield_percentage,
                status, notes, created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                code, req.name, req.fiber_type, req.color_reference, req.color_name,
                req.target_color_hex, req.bath_ratio_l_per_kg, req.temperature_c,
                req.process_time_min, req.yield_percentage, req.status, req.notes,
                current_user["id"],
            ),
        )
        recipe_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # Insertar pasos
        for step in req.steps:
            conn.execute(
                """INSERT INTO recipe_steps
                   (recipe_id, step_order, step_name, step_type, duration_min, temperature_c, ph_target, notes)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (recipe_id, step.step_order, step.step_name, step.step_type,
                 step.duration_min, step.temperature_c, step.ph_target, step.notes),
            )

        # Insertar ingredientes
        for ing in req.ingredients:
            conn.execute(
                """INSERT INTO recipe_ingredients
                   (recipe_id, step_id, chemical_id, quantity_per_kg, unit,
                    tolerance_percentage, is_critical, sort_order, notes)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (recipe_id, ing.step_id, ing.chemical_id, ing.quantity_per_kg,
                 ing.unit, ing.tolerance_percentage, ing.is_critical, ing.sort_order, ing.notes),
            )

        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()

    recipe = row_to_dict(row)
    sync_service.enqueue("recipe", recipe_id, "create", recipe)
    return recipe


@router.put("/{recipe_id}")
def update_recipe(recipe_id: int, req: RecipeUpdate, current_user: dict = Depends(get_current_user)):
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [recipe_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE recipes SET {set_clause}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
            values,
        )
        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()

    recipe = row_to_dict(row)
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


# ---------------------------------------------------------------------------
# Pasos e ingredientes individuales
# ---------------------------------------------------------------------------

@router.post("/{recipe_id}/steps", status_code=201)
def add_step(recipe_id: int, req: RecipeStepCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Receta no encontrada")
        conn.execute(
            """INSERT INTO recipe_steps
               (recipe_id, step_order, step_name, step_type, duration_min, temperature_c, ph_target, notes)
               VALUES (?,?,?,?,?,?,?,?)""",
            (recipe_id, req.step_order, req.step_name, req.step_type,
             req.duration_min, req.temperature_c, req.ph_target, req.notes),
        )
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


@router.post("/{recipe_id}/ingredients", status_code=201)
def add_ingredient(recipe_id: int, req: RecipeIngredientCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL", (recipe_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Receta no encontrada")
        conn.execute(
            """INSERT INTO recipe_ingredients
               (recipe_id, step_id, chemical_id, quantity_per_kg, unit,
                tolerance_percentage, is_critical, sort_order, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (recipe_id, req.step_id, req.chemical_id, req.quantity_per_kg,
             req.unit, req.tolerance_percentage, req.is_critical, req.sort_order, req.notes),
        )
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
