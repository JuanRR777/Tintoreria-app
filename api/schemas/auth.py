from pydantic import BaseModel, Field
from typing import Optional


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: str
    role_id: int
    role_name: Optional[str] = None
    permissions: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    is_active: int


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str
    full_name: str
    password: str = Field(..., min_length=6)
    role_id: int = 1
    phone: Optional[str] = None
    position: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role_id: Optional[int] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    is_active: Optional[int] = None
