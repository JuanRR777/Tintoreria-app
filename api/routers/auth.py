from fastapi import APIRouter, HTTPException, Depends, Header
from typing import Optional
import json
import re

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.auth import LoginRequest, LoginResponse, ChangePasswordRequest, UserCreate, UserUpdate
from services.auth_service import (
    authenticate_user,
    create_access_token,
    get_user_by_token,
    hash_password,
    invalidate_user_cache,
    verify_password,
)
from database.connection import get_db, rows_to_list, row_to_dict, ensure_users_schema

router = APIRouter(prefix="/auth", tags=["auth"])

ALLOWED_IDLE = {0, 15, 30, 60, 120}
ALLOWED_VIEWS = {"dashboard", "stock", "lab", "requests", "recipes", "processes", "weighing", "machines", "reports"}


# ---------------------------------------------------------------------------
# Dependencia reutilizable
# ---------------------------------------------------------------------------

def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    token = authorization.split(" ", 1)[1]
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Token invalido o expirado")
    return user


# ---------------------------------------------------------------------------
# Endpoints de autenticacion
# ---------------------------------------------------------------------------

@router.post("/login")
def login(req: LoginRequest):
    ensure_users_schema()
    user = authenticate_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    token = create_access_token({"sub": str(user["id"]), "username": user["username"]})

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (user["id"],),
        )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id":          user["id"],
            "username":    user["username"],
            "full_name":   user["full_name"],
            "email":       user["email"],
            "role_id":     user["role_id"],
            "role_name":   user["role_name"],
            "permissions": user["permissions"],
            "position":    user["position"],
            "phone":       user["phone"],
            "idle_minutes": int(user.get("idle_minutes") if user.get("idle_minutes") is not None else 30),
        },
    }


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    ensure_users_schema()
    current_user.pop("password_hash", None)
    if current_user.get("idle_minutes") is None:
        current_user["idle_minutes"] = 30
    return current_user


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    # JWT es stateless; el cliente debe descartar el token
    return {"message": "Sesion cerrada correctamente"}


def clean_views(views: Optional[list]) -> list[str]:
    if not views:
        return []
    unknown = [item for item in views if item not in ALLOWED_VIEWS]
    if unknown:
        raise HTTPException(status_code=400, detail="Hay vistas que no existen")
    return list(dict.fromkeys(views))


def role_is_admin(conn, role_id: int) -> bool:
    row = conn.execute("SELECT name, permissions FROM roles WHERE id = ?", (role_id,)).fetchone()
    if not row:
        return False
    if row["name"] == "admin":
        return True
    try:
        perms = json.loads(row["permissions"] or "[]")
    except json.JSONDecodeError:
        perms = []
    return "*" in perms


def assert_idle_minutes(minutes: int) -> int:
    if minutes not in ALLOWED_IDLE:
        raise HTTPException(status_code=400, detail="Tiempo de sesión no válido")
    return minutes


def assert_strong_password(password: str) -> None:
    ok = (
        len(password) >= 8
        and re.search(r"[A-Z]", password)
        and re.search(r"\d", password)
        and re.search(r"[^A-Za-z0-9]", password)
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="La contraseña debe tener 8 caracteres, una mayúscula, un número y un símbolo",
        )


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    assert_strong_password(req.new_password)
    if not verify_password(req.current_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Contrasena actual incorrecta")
    new_hash = hash_password(req.new_password)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
            (new_hash, current_user["id"]),
        )
    invalidate_user_cache()
    return {"message": "Contrasena actualizada correctamente"}


# ---------------------------------------------------------------------------
# Gestion de usuarios (solo admin)
# ---------------------------------------------------------------------------

def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    import json
    perms = json.loads(current_user.get("permissions") or "[]")
    if "*" not in perms:
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")
    return current_user


@router.get("/users")
def list_users(current_user: dict = Depends(require_admin)):
    ensure_users_schema()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.id, u.username, u.email, u.full_name, u.role_id,
                      u.phone, u.position, u.is_active, u.idle_minutes, u.permissions AS user_permissions,
                      u.last_login, u.created_at,
                      r.name AS role_name, r.permissions AS role_permissions
               FROM users u JOIN roles r ON u.role_id = r.id
               ORDER BY u.created_at DESC"""
        ).fetchall()
    return rows_to_list(rows)


@router.post("/users", status_code=201)
def create_user(req: UserCreate, current_user: dict = Depends(require_admin)):
    ensure_users_schema()
    idle = assert_idle_minutes(int(req.idle_minutes))
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            (req.username, req.email),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="El usuario o email ya existe")

        assert_strong_password(req.password)
        pw_hash = hash_password(req.password)
        permissions = None if role_is_admin(conn, req.role_id) else json.dumps(clean_views(req.views))
        conn.execute(
            """INSERT INTO users (username, email, password_hash, full_name, role_id, phone, position, idle_minutes, permissions)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (req.username, req.email, pw_hash, req.full_name, req.role_id, req.phone, req.position, idle, permissions),
        )
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT id, username, full_name, email, role_id FROM users WHERE id = ?", (user_id,)).fetchone()
    invalidate_user_cache()
    return row_to_dict(row)


@router.put("/users/{user_id}")
def update_user(user_id: int, req: UserUpdate, current_user: dict = Depends(require_admin)):
    ensure_users_schema()
    raw = req.model_dump(exclude_unset=True)
    views = raw.pop("views", None)
    fields = {k: v for k, v in raw.items() if v is not None}
    if "idle_minutes" in fields:
        fields["idle_minutes"] = assert_idle_minutes(int(fields["idle_minutes"]))
    if fields.get("is_active") == 0 and user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
    new_password = fields.pop("password", None)
    if new_password is not None:
        assert_strong_password(new_password)
        fields["password_hash"] = hash_password(new_password)
    if not fields and views is None:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    with get_db() as conn:
        existing = conn.execute("SELECT role_id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        final_role = fields.get("role_id", existing["role_id"])
        if role_is_admin(conn, final_role):
            fields["permissions"] = None
        elif views is not None:
            fields["permissions"] = json.dumps(clean_views(views))
        if not fields:
            raise HTTPException(status_code=400, detail="No hay campos para actualizar")
        assignments = []
        values = []
        for key, value in fields.items():
            assignments.append(f"{key} = ?" if value is not None else f"{key} = NULL")
            if value is not None:
                values.append(value)
        values.append(user_id)
        conn.execute(
            f"UPDATE users SET {', '.join(assignments)}, updated_at = datetime('now') WHERE id = ?",
            values,
        )
    invalidate_user_cache()
    return {"message": "Usuario actualizado"}


@router.get("/roles")
def list_roles(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, display_name, description, permissions FROM roles ORDER BY id").fetchall()
    return rows_to_list(rows)
