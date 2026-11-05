from pydantic import BaseModel, Field
from typing import Optional, Literal


MachineType   = Literal["tintura", "lavado", "secado", "cardado", "peinado", "hilado", "otros"]
EquipmentType = Literal["jet", "overflow", "carretel", "autoclave", "continuo", "barca", "jigger", "otro"]
DyeFormat     = Literal["madeja", "cono", "ambos"]
MachineStatus = Literal["active", "maintenance", "inactive"]


class MachineCreate(BaseModel):
    name: str = Field(..., min_length=1)
    code: Optional[str] = None
    machine_type: MachineType = "tintura"
    equipment_type: Optional[EquipmentType] = None
    dye_format: DyeFormat = "ambos"
    capacity_kg: float = 0
    water_capacity_liters: float = 0
    manufacture_year: Optional[int] = None
    status: MachineStatus = "active"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    installation_date: Optional[str] = None
    last_maintenance: Optional[str] = None
    next_maintenance_due: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class MachineUpdate(BaseModel):
    name: Optional[str] = None
    machine_type: Optional[MachineType] = None
    equipment_type: Optional[EquipmentType] = None
    dye_format: Optional[DyeFormat] = None
    capacity_kg: Optional[float] = None
    water_capacity_liters: Optional[float] = None
    manufacture_year: Optional[int] = None
    status: Optional[MachineStatus] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    installation_date: Optional[str] = None
    last_maintenance: Optional[str] = None
    next_maintenance_due: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class ScaleCreate(BaseModel):
    name: str = Field(..., min_length=1)
    identifier: Optional[str] = None
    port: Optional[str] = None
    baud_rate: int = 9600
    data_bits: int = 8
    parity: str = "N"
    stop_bits: int = 1
    protocol: str = "generic"
    unit: str = "g"
    precision_decimals: int = 2
    max_weight: Optional[float] = None
    notes: Optional[str] = None


class ScaleUpdate(BaseModel):
    name: Optional[str] = None
    port: Optional[str] = None
    baud_rate: Optional[int] = None
    data_bits: Optional[int] = None
    parity: Optional[str] = None
    stop_bits: Optional[int] = None
    protocol: Optional[str] = None
    unit: Optional[str] = None
    precision_decimals: Optional[int] = None
    max_weight: Optional[float] = None
    is_active: Optional[int] = None
    last_calibration: Optional[str] = None
    notes: Optional[str] = None
