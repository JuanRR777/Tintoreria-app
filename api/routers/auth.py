from fastapi import APIRouter, HTTPException, Depends, Header
from typing import Optional

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
from database.connection import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/auth", tags=["auth"])


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
        },
    }


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    current_user.pop("password_hash", None)
    return current_user


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    # JWT es stateless; el cliente debe descartar el token
    return {"message": "Sesion cerrada correctamente"}


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
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
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.id, u.username, u.email, u.full_name, u.role_id,
                      u.phone, u.position, u.is_active, u.last_login, u.created_at,
                      r.name AS role_name
               FROM users u JOIN roles r ON u.role_id = r.id
               ORDER BY u.created_at DESC"""
        ).fetchall()
    return rows_to_list(rows)


@router.post("/users", status_code=201)
def create_user(req: UserCreate, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            (req.username, req.email),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="El usuario o email ya existe")

        pw_hash = hash_password(req.password)
        conn.execute(
            """INSERT INTO users (username, email, password_hash, full_name, role_id, phone, position)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (req.username, req.email, pw_hash, req.full_name, req.role_id, req.phone, req.position),
        )
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT id, username, full_name, email, role_id FROM users WHERE id = ?", (user_id,)).fetchone()
    invalidate_user_cache()
    return row_to_dict(row)


@router.put("/users/{user_id}")
def update_user(user_id: int, req: UserUpdate, current_user: dict = Depends(require_admin)):
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [user_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE users SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            values,
        )
    invalidate_user_cache()
    return {"message": "Usuario actualizado"}


@router.get("/roles")
def list_roles(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, display_name, description FROM roles ORDER BY id").fetchall()
    return rows_to_list(rows)
