from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_chats() -> dict[str, str]:
    return {"status": "planned"}
