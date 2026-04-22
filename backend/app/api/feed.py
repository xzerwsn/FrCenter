from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def feed() -> dict[str, str]:
    return {"status": "planned"}
