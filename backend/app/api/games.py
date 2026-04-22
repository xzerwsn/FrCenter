from fastapi import APIRouter

router = APIRouter()


@router.get("/activity")
async def game_activity() -> dict[str, str]:
    return {"status": "planned"}
