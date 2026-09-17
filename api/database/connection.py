import os
import re
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Optional

import httpx

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import WORKER_API_KEY, WORKER_URL
from services import d1_cache


class D1Error(RuntimeError):
    """Error al consultar Cloudflare D1 a traves del Worker."""


class D1Row(dict, Mapping):
    """Fila compatible con sqlite3.Row: row['col'] y row[0]."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class D1Cursor:
    def __init__(self, conn: "D1Connection"):
        self._conn = conn
        self._rows: list[D1Row] = []
        self.rowcount = -1
        self.lastrowid: Optional[int] = None

    def execute(self, sql: str, params: Any = None) -> "D1Cursor":
        params = list(params or [])
        sql_stripped = sql.strip()

        if re.search(r"select\s+last_insert_rowid\s*\(\s*\)", sql_stripped, re.I):
            self._rows = [D1Row({"id": self._conn.lastrowid})]
            self.rowcount = 1
            return self

        if d1_cache.is_write(sql_stripped):
            d1_cache.invalidate()
            result = self._conn.client.query(sql_stripped, params)
        else:
            result = d1_cache.remember(
                sql_stripped,
                params,
                lambda: self._conn.client.query(sql_stripped, params),
            )

        meta = result.get("meta") or {}

        if re.match(r"^\s*(INSERT|REPLACE)\b", sql_stripped, re.I):
            last_id = meta.get("last_row_id")
            if last_id is not None:
                self._conn.lastrowid = last_id
                self.lastrowid = last_id

        changes = meta.get("changes")
        self.rowcount = changes if changes is not None else -1
        self._rows = [D1Row(row) for row in (result.get("results") or [])]
        return self

    def fetchall(self) -> list[D1Row]:
        return self._rows

    def fetchone(self) -> Optional[D1Row]:
        return self._rows[0] if self._rows else None


class D1Client:
    def __init__(self, base_url: str, api_key: str):
        if not base_url:
            raise D1Error(
                "WORKER_URL no esta configurado. Define WORKER_URL en api/.env"
            )
        if not api_key:
            raise D1Error(
                "WORKER_API_KEY no esta configurado. Define WORKER_API_KEY en api/.env"
            )
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._http = httpx.Client(timeout=30.0)

    def query(self, sql: str, params: list) -> dict:
        try:
            response = self._http.post(
                f"{self.base_url}/query",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={"sql": sql, "params": params},
            )
        except httpx.RequestError as exc:
            raise D1Error(f"No se pudo conectar con el Worker D1: {exc}") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise D1Error(f"Respuesta invalida del Worker ({response.status_code})") from exc

        if response.status_code >= 400:
            raise D1Error(payload.get("error") or f"Error D1 HTTP {response.status_code}")

        return payload


class D1Connection:
    def __init__(self, client: D1Client):
        self.client = client
        self.lastrowid: Optional[int] = None

    def execute(self, sql: str, params: Any = None) -> D1Cursor:
        return D1Cursor(self).execute(sql, params)

    def executemany(self, sql: str, seq_of_params) -> D1Cursor:
        cursor = D1Cursor(self)
        for params in seq_of_params:
            cursor.execute(sql, params)
        return cursor

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None


_client: Optional[D1Client] = None


def _get_client() -> D1Client:
    global _client
    if _client is None:
        _client = D1Client(WORKER_URL, WORKER_API_KEY)
    return _client


@contextmanager
def get_db() -> Generator[D1Connection, None, None]:
    conn = D1Connection(_get_client())
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise


def rows_to_list(rows) -> list:
    return [dict(row) for row in rows]


def row_to_dict(row) -> dict | None:
    return dict(row) if row else None


def init_db() -> None:
    """Verifica D1 y siembra roles/admin si la base esta vacia."""
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            _seed(conn)


def _seed(conn: D1Connection) -> None:
    from passlib.context import CryptContext

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

    roles = [
        (1, "admin", "Administrador", "Acceso completo al sistema", '["*"]'),
        (2, "laboratorio", "Personal Laboratorio", "Gestion de quimicos y recetas", '["dashboard","quimicos.all","recetas.all","procesos.all","maquinas.read"]'),
        (3, "produccion", "Personal Produccion", "Ejecucion de procesos", '["dashboard","procesos.all","quimicos.read","recetas.read"]'),
        (4, "consulta", "Consulta", "Solo lectura y reportes", '["dashboard","reportes.all"]'),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO roles (id, name, display_name, description, permissions) VALUES (?,?,?,?,?)",
        roles,
    )

    admin_hash = pwd_ctx.hash("admin123")
    conn.execute(
        """INSERT INTO users (username, email, password_hash, full_name, role_id)
           VALUES ('admin', 'admin@tintoreria.local', ?, 'Administrador del Sistema', 1)""",
        (admin_hash,),
    )

    sequences = [
        (1, "batch", 1, "LOTE", 6),
        (2, "recipe", 1, "REC", 4),
        (3, "chemical", 1, "QMC", 4),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO code_sequences (id, sequence_type, current_value, prefix, digits) VALUES (?,?,?,?,?)",
        sequences,
    )


def generate_code(sequence_type: str) -> str:
    """Genera el siguiente codigo autoincrementado para el tipo dado."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT current_value, prefix, digits FROM code_sequences WHERE sequence_type = ?",
            (sequence_type,),
        ).fetchone()
        if not row:
            raise ValueError(f"Tipo de secuencia '{sequence_type}' no encontrado")

        code = f"{row['prefix']}{str(row['current_value']).zfill(row['digits'])}"
        conn.execute(
            "UPDATE code_sequences SET current_value = current_value + 1, updated_at = datetime('now') WHERE sequence_type = ?",
            (sequence_type,),
        )
        return code
