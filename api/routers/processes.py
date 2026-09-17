from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.process import ProcessCreate, ProcessStatusUpdate, WeighingUpdate
from database.connection import get_db, rows_to_list, row_to_dict, generate_code
from routers.auth import get_current_user
from services import sync_service

router = APIRouter(prefix="/processes", tags=["processes"])


def _calculate_water(bath_ratio: Optional[float], fiber_weight_kg: float) -> Optional[float]:
    if bath_ratio and fiber_weight_kg:
        return round(bath_ratio * fiber_weight_kg, 2)
    return None


@router.get("")
def list_processes(
    status:   Optional[str] = Query(None),
    search:   Optional[str] = Query(None),
    limit:    int           = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT p.*, r.code AS recipe_code, r.name AS recipe_name,
               m.name AS machine_name, u.full_name AS operator_name
        FROM processes p
        JOIN recipes r ON p.recipe_id = r.id
        LEFT JOIN machines m ON p.machine_id = m.id
        JOIN users u ON p.operator_id = u.id
        WHERE 1=1
    """
    params: list = []

    if status:
        query += " AND p.status = ?"
        params.append(status)
    if search:
        query += " AND (p.batch_number LIKE ? OR r.name LIKE ?)"
        params += [f"%{search}%", f"%{search}%"]

    query += " ORDER BY p.created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


@router.get("/{process_id}")
def get_process(process_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            """SELECT p.*, r.code AS recipe_code, r.name AS recipe_name,
                      r.bath_ratio_l_per_kg, r.temperature_c AS recipe_temp,
                      m.name AS machine_name, u.full_name AS operator_name
               FROM processes p
               JOIN recipes r ON p.recipe_id = r.id
               LEFT JOIN machines m ON p.machine_id = m.id
               JOIN users u ON p.operator_id = u.id
               WHERE p.id = ?""",
            (process_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        weighings = rows_to_list(
            conn.execute(
                """SELECT pw.*, c.name AS chemical_name, c.code AS chemical_code,
                          cl.lot_number, s.name AS scale_name
                   FROM process_weighings pw
                   JOIN chemicals c ON pw.chemical_id = c.id
                   LEFT JOIN chemical_lots cl ON pw.lot_id = cl.id
                   LEFT JOIN scales s ON pw.scale_id = s.id
                   WHERE pw.process_id = ?
                   ORDER BY pw.id""",
                (process_id,),
            ).fetchall()
        )

        logs = rows_to_list(
            conn.execute(
                """SELECT pl.*, u.full_name AS user_name
                   FROM process_logs pl
                   LEFT JOIN users u ON pl.user_id = u.id
                   WHERE pl.process_id = ?
                   ORDER BY pl.timestamp""",
                (process_id,),
            ).fetchall()
        )

    process = row_to_dict(row)
    process["weighings"] = weighings
    process["logs"] = logs
    return process


@router.post("", status_code=201)
def create_process(req: ProcessCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        recipe = row_to_dict(
            conn.execute(
                "SELECT * FROM recipes WHERE id = ? AND is_active = 1 AND deleted_at IS NULL",
                (req.recipe_id,),
            ).fetchone()
        )
        if not recipe:
            raise HTTPException(status_code=404, detail="Receta no encontrada")

        batch_number = generate_code("batch")
        water_liters = _calculate_water(recipe.get("bath_ratio_l_per_kg"), req.fiber_weight_kg)

        conn.execute(
            """INSERT INTO processes
               (batch_number, recipe_id, machine_id, fiber_type, fiber_weight_kg,
                water_volume_liters, color_reference, operator_id, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                batch_number, req.recipe_id, req.machine_id, req.fiber_type,
                req.fiber_weight_kg, water_liters, req.color_reference or recipe.get("color_reference"),
                current_user["id"], req.notes,
            ),
        )
        process_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # Crear registros de pesaje para cada ingrediente de la receta
        ingredients = conn.execute(
            """SELECT ri.*, c.name AS chemical_name
               FROM recipe_ingredients ri
               JOIN chemicals c ON ri.chemical_id = c.id
               WHERE ri.recipe_id = ?
               ORDER BY ri.sort_order, ri.id""",
            (req.recipe_id,),
        ).fetchall()

        for ing in ingredients:
            expected_qty = round(ing["quantity_per_kg"] * req.fiber_weight_kg, 3)
            conn.execute(
                """INSERT INTO process_weighings
                   (process_id, recipe_ingredient_id, chemical_id,
                    expected_quantity, unit)
                   VALUES (?,?,?,?,?)""",
                (process_id, ing["id"], ing["chemical_id"], expected_qty, ing["unit"]),
            )

        # Log de creacion
        conn.execute(
            """INSERT INTO process_logs (process_id, event_type, description, user_id)
               VALUES (?, 'create', ?, ?)""",
            (process_id, f"Proceso creado. Lote: {batch_number}. Fibra: {req.fiber_weight_kg} kg", current_user["id"]),
        )

        row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()

    process = row_to_dict(row)
    sync_service.enqueue("process", process_id, "create", process)
    return process


@router.patch("/{process_id}/status")
def update_process_status(
    process_id: int,
    req: ProcessStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        current = row_to_dict(
            conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()
        )
        if not current:
            raise HTTPException(status_code=404, detail="Proceso no encontrado")

        updates: dict = {"status": req.status}

        if req.status == "in_progress" and not current.get("started_at"):
            updates["started_at"] = "datetime('now')"
        if req.status == "completed":
            updates["completed_at"] = "datetime('now')"
            if req.quality_score is not None:
                updates["quality_score"] = req.quality_score
            # Descontar stock por cada pesaje validado
            _deduct_stock(conn, process_id, current_user["id"])
            # Encolar para sync
            sync_service.enqueue("process", process_id, "update", {"id": process_id, "status": "completed"})

        if req.notes:
            updates["notes"] = req.notes

        # Construir SET dinamico respetando funciones SQL
        set_parts = []
        params = []
        for key, val in updates.items():
            if isinstance(val, str) and val.startswith("datetime("):
                set_parts.append(f"{key} = {val}")
            else:
                set_parts.append(f"{key} = ?")
                params.append(val)

        set_parts.append("updated_at = datetime('now')")
        params.append(process_id)

        conn.execute(
            f"UPDATE processes SET {', '.join(set_parts)} WHERE id = ?",
            params,
        )

        event_map = {
            "in_progress": "start",
            "paused": "pause",
            "completed": "complete",
            "cancelled": "cancel",
        }
        event = event_map.get(req.status, req.status)
        conn.execute(
            "INSERT INTO process_logs (process_id, event_type, description, user_id) VALUES (?,?,?,?)",
            (process_id, event, req.notes or f"Estado cambiado a {req.status}", current_user["id"]),
        )

        row = conn.execute("SELECT * FROM processes WHERE id = ?", (process_id,)).fetchone()

    return row_to_dict(row)


def _deduct_stock(conn, process_id: int, user_id: int) -> None:
    """Descuenta el stock de cada pesaje completado del proceso."""
    weighings = conn.execute(
        "SELECT * FROM process_weighings WHERE process_id = ? AND status IN ('weighed','validated')",
        (process_id,),
    ).fetchall()

    for w in weighings:
        qty = w["actual_quantity"] or w["expected_quantity"]
        if not qty:
            continue

        if w["lot_id"]:
            conn.execute(
                "UPDATE chemical_lots SET quantity_remaining = MAX(0, quantity_remaining - ?), updated_at = datetime('now') WHERE id = ?",
                (qty, w["lot_id"]),
            )
            # Actualizar status del lote si se agoto
            lot = conn.execute("SELECT quantity_remaining FROM chemical_lots WHERE id = ?", (w["lot_id"],)).fetchone()
            if lot and lot["quantity_remaining"] <= 0:
                conn.execute("UPDATE chemical_lots SET status = 'depleted' WHERE id = ?", (w["lot_id"],))

        conn.execute(
            "UPDATE chemicals SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = datetime('now') WHERE id = ?",
            (qty, w["chemical_id"]),
        )

        conn.execute(
            """INSERT INTO stock_movements
               (chemical_id, lot_id, movement_type, quantity, unit, reference_type, reference_id, notes, user_id)
               VALUES (?,?,'out',?,?,'process',?,?,?)""",
            (w["chemical_id"], w["lot_id"], qty, w["unit"],
             process_id, f"Consumo proceso #{process_id}", user_id),
        )


# ---------------------------------------------------------------------------
# Pesajes
# ---------------------------------------------------------------------------

@router.get("/{process_id}/weighings")
def list_weighings(process_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT pw.*, c.name AS chemical_name, c.code AS chemical_code,
                      cl.lot_number, s.name AS scale_name
               FROM process_weighings pw
               JOIN chemicals c ON pw.chemical_id = c.id
               LEFT JOIN chemical_lots cl ON pw.lot_id = cl.id
               LEFT JOIN scales s ON pw.scale_id = s.id
               WHERE pw.process_id = ?
               ORDER BY pw.id""",
            (process_id,),
        ).fetchall()
    return rows_to_list(rows)


@router.patch("/{process_id}/weighings/{weighing_id}")
def update_weighing(
    process_id: int,
    weighing_id: int,
    req: WeighingUpdate,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        w = row_to_dict(
            conn.execute(
                "SELECT * FROM process_weighings WHERE id = ? AND process_id = ?",
                (weighing_id, process_id),
            ).fetchone()
        )
        if not w:
            raise HTTPException(status_code=404, detail="Pesaje no encontrado")

        expected = w["expected_quantity"]
        actual   = req.actual_quantity

        if expected > 0:
            variance = round(abs(actual - expected) / expected * 100, 2)
        else:
            variance = 0

        # Obtener tolerancia del ingrediente de la receta
        ing = row_to_dict(
            conn.execute(
                "SELECT tolerance_percentage FROM recipe_ingredients WHERE id = ?",
                (w["recipe_ingredient_id"],),
            ).fetchone()
        )
        tolerance = ing["tolerance_percentage"] if ing else 5
        within = int(variance <= tolerance)

        conn.execute(
            """UPDATE process_weighings
               SET actual_quantity = ?, lot_id = ?, scale_id = ?,
                   variance_percentage = ?, is_within_tolerance = ?,
                   status = 'weighed', weighed_at = datetime('now'),
                   notes = ?, updated_at = datetime('now')
               WHERE id = ?""",
            (actual, req.lot_id, req.scale_id, variance, within,
             req.notes, weighing_id),
        )

        # Log del pesaje
        conn.execute(
            """INSERT INTO process_logs (process_id, event_type, description, data, user_id)
               VALUES (?, 'weigh', ?, ?, ?)""",
            (
                process_id,
                f"Pesaje registrado: esperado={expected}, real={actual}, variacion={variance}%",
                f'{{"weighing_id":{weighing_id},"expected":{expected},"actual":{actual},"variance":{variance}}}',
                current_user["id"],
            ),
        )

        row = conn.execute(
            """SELECT pw.*, c.name AS chemical_name
               FROM process_weighings pw JOIN chemicals c ON pw.chemical_id = c.id
               WHERE pw.id = ?""",
            (weighing_id,),
        ).fetchone()

    return row_to_dict(row)
