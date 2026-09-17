"""
Servicio de lectura de basculas via RS-232/USB (pyserial).

Soporta los protocolos mas comunes:
  - generic  : cualquier linea ASCII que contenga un numero decimal
  - toledo   : "S S     123.45 g" o "+ 1234.5 g"
  - sartorius: "+   123.456 g"
  - mettler  : "S      123.45 g"

El metodo `stream_weight` es un generador asincrono que emite lecturas
continuas; se usa desde el endpoint WebSocket en routers/scales.py.
"""

import asyncio
import re
from typing import Optional, AsyncGenerator

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False


_PATTERNS: dict[str, re.Pattern] = {
    "generic":  re.compile(r"([+-]?\d+\.?\d*)"),
    "toledo":   re.compile(r"[A-Z]\s+([+-]?\d+\.?\d+)\s*[a-zA-Z]"),
    "sartorius":re.compile(r"[+-]\s*(\d+\.?\d+)\s*[a-zA-Z]"),
    "mettler":  re.compile(r"[A-Z]{1,2}\s+(\d+\.?\d+)"),
}


def list_ports() -> list[dict]:
    """Retorna los puertos seriales disponibles en el sistema."""
    if not SERIAL_AVAILABLE:
        return []
    return [
        {"port": p.device, "description": p.description, "hwid": p.hwid}
        for p in serial.tools.list_ports.comports()
    ]


def _parse_weight(raw: str, protocol: str) -> Optional[float]:
    pattern = _PATTERNS.get(protocol, _PATTERNS["generic"])
    match = pattern.search(raw.strip())
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def _blocking_read(ser) -> Optional[float]:
    """Lee una linea del puerto serial de forma bloqueante (corre en executor)."""
    try:
        line = ser.readline().decode("ascii", errors="ignore")
        return line
    except Exception:
        return None


async def stream_weight(
    port: str,
    baud_rate: int,
    protocol: str,
    data_bits: int = 8,
    parity: str = "N",
    stop_bits: int = 1,
    read_interval: float = 0.1,
) -> AsyncGenerator[dict, None]:
    """
    Generador asincrono que emite lecturas de peso desde el puerto serial.
    Cada elemento es un dict: {"weight": float, "raw": str, "stable": bool}
    """
    if not SERIAL_AVAILABLE:
        raise RuntimeError("pyserial no esta instalado")

    loop = asyncio.get_event_loop()
    ser = serial.Serial(
        port=port,
        baudrate=baud_rate,
        bytesize=data_bits,
        parity=parity,
        stopbits=stop_bits,
        timeout=1,
    )

    last_values: list[float] = []
    STABILITY_WINDOW = 5  # lecturas para considerar estable

    try:
        while True:
            raw = await loop.run_in_executor(None, _blocking_read, ser)
            if raw is None:
                await asyncio.sleep(read_interval)
                continue

            weight = _parse_weight(raw, protocol)
            if weight is None:
                await asyncio.sleep(read_interval)
                continue

            last_values.append(weight)
            if len(last_values) > STABILITY_WINDOW:
                last_values.pop(0)

            stable = (
                len(last_values) == STABILITY_WINDOW
                and max(last_values) - min(last_values) < 0.5
            )

            yield {"weight": weight, "raw": raw.strip(), "stable": stable}
            await asyncio.sleep(read_interval)
    finally:
        if ser.is_open:
            ser.close()


async def read_once(
    port: str,
    baud_rate: int = 9600,
    protocol: str = "generic",
    timeout: float = 3.0,
) -> Optional[float]:
    """Lee un unico valor estable de la bascula (util para pruebas de conexion)."""
    try:
        async for reading in stream_weight(port, baud_rate, protocol, read_interval=0.1):
            if reading["stable"]:
                return reading["weight"]
            if timeout <= 0:
                return reading["weight"]
            timeout -= 0.1
    except Exception:
        return None
    return None
