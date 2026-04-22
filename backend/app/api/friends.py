from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_friends() -> dict[str, str]:
    return {"status": "planned"}
