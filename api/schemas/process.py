from pydantic import BaseModel, Field
from typing import Optional, Literal


ProcessStatus = Literal["pending", "in_progress", "paused", "completed", "cancelled"]
WeighingStatus = Literal["pending", "weighed", "validated", "skipped"]


class ProcessCreate(BaseModel):
    recipe_id: int
    machine_id: Optional[int] = None
    fiber_type: Optional[str] = None
    fiber_weight_kg: float = Field(..., gt=0)
    color_reference: Optional[str] = None
    notes: Optional[str] = None


class ProcessStatusUpdate(BaseModel):
    status: ProcessStatus
    notes: Optional[str] = None
    quality_score: Optional[float] = Field(None, ge=0, le=10)


class WeighingUpdate(BaseModel):
    actual_quantity: float = Field(..., ge=0)
    lot_id: Optional[int] = None
    scale_id: Optional[int] = None
    notes: Optional[str] = None
