from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeviceRegisterRequest(BaseModel):
    device_name: str = Field(min_length=1, max_length=120)
    public_key: str = Field(min_length=16)
    encrypted_private_key: str = Field(min_length=16)


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_name: str
    public_key: str
    encrypted_private_key: str
    last_seen_at: datetime
    created_at: datetime


class DevicePublicKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    device_name: str
    public_key: str
    last_seen_at: datetime


class DeviceListResponse(BaseModel):
    devices: list[DeviceResponse]


class DevicePublicKeyListResponse(BaseModel):
    devices: list[DevicePublicKeyResponse]
