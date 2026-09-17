from datetime import datetime, timedelta
from typing import Optional
import copy
import threading
import time

from jose import JWTError, jwt
from passlib.context import CryptContext

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_HOURS
from database.connection import get_db, row_to_dict

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_USER_TTL_SEC = 600
_user_lock = threading.Lock()
_user_by_token: dict[str, tuple[float, dict]] = {}


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=JWT_EXPIRE_HOURS))
    payload["exp"] = expire
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def authenticate_user(username: str, password: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            """SELECT u.*, r.name AS role_name, r.permissions
               FROM users u
               JOIN roles r ON u.role_id = r.id
               WHERE u.username = ? AND u.is_active = 1""",
            (username,),
        ).fetchone()

    if not row:
        return None
    user = dict(row)
    if not verify_password(password, user["password_hash"]):
        return None
    return user


def invalidate_user_cache() -> None:
    with _user_lock:
        _user_by_token.clear()


def get_user_by_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    now = time.monotonic()
    with _user_lock:
        cached = _user_by_token.get(token)
        if cached and now - cached[0] <= _USER_TTL_SEC:
            return copy.deepcopy(cached[1])

    with get_db() as conn:
        row = conn.execute(
            """SELECT u.*, r.name AS role_name, r.permissions
               FROM users u
               JOIN roles r ON u.role_id = r.id
               WHERE u.id = ? AND u.is_active = 1""",
            (int(user_id),),
        ).fetchone()

    user = row_to_dict(row)
    if user:
        with _user_lock:
            _user_by_token[token] = (time.monotonic(), copy.deepcopy(user))
    return user
