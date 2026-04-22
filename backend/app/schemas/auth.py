from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=8, max_length=256)
    cloud_password: str = Field(min_length=8, max_length=256)


class RegisterResponse(BaseModel):
    status: str
    email: EmailStr
    dev_confirmation_code: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ConfirmEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class MessageResponse(BaseModel):
    status: str
