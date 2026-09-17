from pydantic import BaseModel, Field
from typing import Optional, Literal


ChemicalType = Literal[
    "acido", "reactivo", "directo", "auxiliar",
    "mordiente", "disperso", "vat", "blanqueador", "otros"
]
UnitType = Literal["kg", "g", "L", "mL"]
LotStatus = Literal["active", "depleted", "expired"]
MovementType = Literal["in", "out", "adjustment", "waste", "return"]


class ChemicalCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = None  # se genera automaticamente si no se provee
    chemical_type: ChemicalType
    unit: UnitType = "kg"
    density_g_ml: Optional[float] = None
    min_stock_alert: float = 0
    max_stock: Optional[float] = None
    location: Optional[str] = None
    supplier: Optional[str] = None
    cas_number: Optional[str] = None
    is_hazardous: int = 0
    safety_notes: Optional[str] = None
    notes: Optional[str] = None


class ChemicalUpdate(BaseModel):
    name: Optional[str] = None
    chemical_type: Optional[ChemicalType] = None
    unit: Optional[UnitType] = None
    density_g_ml: Optional[float] = None
    min_stock_alert: Optional[float] = None
    max_stock: Optional[float] = None
    location: Optional[str] = None
    supplier: Optional[str] = None
    cas_number: Optional[str] = None
    is_hazardous: Optional[int] = None
    safety_notes: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[int] = None


class LotCreate(BaseModel):
    lot_number: str = Field(..., min_length=1)
    quantity_received: float = Field(..., gt=0)
    unit: UnitType
    purchase_date: Optional[str] = None
    expiry_date: Optional[str] = None
    unit_cost: float = 0
    supplier: Optional[str] = None
    notes: Optional[str] = None


class StockAdjustment(BaseModel):
    lot_id: Optional[int] = None
    movement_type: MovementType
    quantity: float = Field(..., gt=0)
    unit: UnitType
    notes: Optional[str] = None
