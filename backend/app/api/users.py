from fastapi import APIRouter

router = APIRouter()


@router.get("/me")
async def me() -> dict[str, str]:
    return {"status": "planned"}
