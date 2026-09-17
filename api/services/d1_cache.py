"""Cache en memoria de lecturas D1. Se invalida en cualquier escritura."""

from __future__ import annotations

import copy
import re
import threading
import time
from typing import Any, Callable, Optional

TTL_SEC = 300
_WRITE = re.compile(r"^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b", re.I)

_lock = threading.Lock()
_store: dict[tuple, tuple[float, Any]] = {}
_inflight: dict[tuple, threading.Event] = {}


def cache_key(sql: str, params: list | None) -> tuple:
    normalized = re.sub(r"\s+", " ", (sql or "").strip())
    return (normalized, tuple(params or []))


def is_write(sql: str) -> bool:
    return bool(_WRITE.match(sql or ""))


def get(sql: str, params: list | None) -> Optional[Any]:
    key = cache_key(sql, params)
    with _lock:
        item = _store.get(key)
        if not item:
            return None
        stamped, payload = item
        if time.monotonic() - stamped > TTL_SEC:
            _store.pop(key, None)
            return None
        return copy.deepcopy(payload)


def put(sql: str, params: list | None, payload: Any) -> None:
    key = cache_key(sql, params)
    with _lock:
        _store[key] = (time.monotonic(), copy.deepcopy(payload))


def invalidate() -> None:
    with _lock:
        _store.clear()


def remember(sql: str, params: list | None, fetch: Callable[[], Any]) -> Any:
    """Devuelve cache o ejecuta fetch. Junta peticiones identicas en vuelo."""
    cached = get(sql, params)
    if cached is not None:
        return cached

    key = cache_key(sql, params)
    wait_event: Optional[threading.Event] = None
    created = False
    with _lock:
        existing = _inflight.get(key)
        if existing:
            wait_event = existing
        else:
            wait_event = threading.Event()
            _inflight[key] = wait_event
            created = True

    if not created:
        wait_event.wait(timeout=30)
        cached = get(sql, params)
        if cached is not None:
            return cached
        return fetch()

    try:
        payload = fetch()
        put(sql, params, payload)
        return copy.deepcopy(payload)
    finally:
        with _lock:
            _inflight.pop(key, None)
        wait_event.set()
