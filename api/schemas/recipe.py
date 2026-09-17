from pydantic import BaseModel, Field
from typing import Optional, List, Literal


FiberType = Literal["lana", "algodon", "acrilico", "poliester", "nylon", "seda", "mezcla", "otros"]
RecipeStatus = Literal["active", "draft", "archived"]
StepType = Literal["pre_lavado", "bano_tinte", "fijacion", "lavado", "enjuague", "secado", "otros"]


class RecipeStepCreate(BaseModel):
    step_order: int
    step_name: str = Field(..., min_length=1)
    step_type: StepType
    duration_min: Optional[int] = None
    temperature_c: Optional[float] = None
    ph_target: Optional[float] = None
    notes: Optional[str] = None


class RecipeIngredientCreate(BaseModel):
    step_id: Optional[int] = None
    chemical_id: int
    quantity_per_kg: float = Field(..., gt=0)
    unit: str
    tolerance_percentage: float = 5
    is_critical: int = 0
    sort_order: int = 0
    notes: Optional[str] = None


class RecipeCreate(BaseModel):
    code: Optional[str] = None  # se genera automaticamente si no se provee
    name: str = Field(..., min_length=1, max_length=255)
    fiber_type: Optional[FiberType] = None
    color_reference: Optional[str] = None
    color_name: Optional[str] = None
    target_color_hex: Optional[str] = None
    bath_ratio_l_per_kg: Optional[float] = None
    temperature_c: Optional[float] = None
    process_time_min: Optional[int] = None
    yield_percentage: float = 100
    status: RecipeStatus = "active"
    notes: Optional[str] = None
    steps: List[RecipeStepCreate] = []
    ingredients: List[RecipeIngredientCreate] = []


class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    fiber_type: Optional[FiberType] = None
    color_reference: Optional[str] = None
    color_name: Optional[str] = None
    target_color_hex: Optional[str] = None
    bath_ratio_l_per_kg: Optional[float] = None
    temperature_c: Optional[float] = None
    process_time_min: Optional[int] = None
    yield_percentage: Optional[float] = None
    status: Optional[RecipeStatus] = None
    notes: Optional[str] = None
