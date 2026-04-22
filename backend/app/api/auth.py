from fastapi import APIRouter

router = APIRouter()


@router.post("/register", status_code=202)
async def register() -> dict[str, str]:
    return {"status": "planned"}


@router.post("/login")
async def login() -> dict[str, str]:
    return {"status": "planned"}


@router.post("/confirm-email")
async def confirm_email() -> dict[str, str]:
    return {"status": "planned"}
