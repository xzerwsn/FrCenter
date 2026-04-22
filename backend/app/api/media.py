from fastapi import APIRouter

router = APIRouter()


@router.post("/upload")
async def upload_media() -> dict[str, str]:
    return {"status": "planned"}
