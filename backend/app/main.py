from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.responses import Response

from app.api.router import api_router
from app.api.ws import router as ws_router
from app.core.config import settings
from app.db.session import AsyncSessionLocal, init_db
from app.services.notification_service import create_deploy_notifications


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_create_tables:
        await init_db()
    if (
        settings.deploy_notification_has_changes
        and settings.deploy_notification_key
        and settings.deploy_notification_body
    ):
        async with AsyncSessionLocal() as db:
            await create_deploy_notifications(
                db,
                title=settings.deploy_notification_title,
                body=settings.deploy_notification_body,
                deployment_key=settings.deploy_notification_key,
            )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_origin_regex=settings.frontend_origin_regex if settings.app_env == "development" else None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def apply_cache_headers(request, call_next):
        response: Response = await call_next(request)
        if request.method != "GET":
            return response

        path = request.url.path
        if path.startswith("/api/media/public/"):
            response.headers.setdefault("Cache-Control", "public, max-age=2592000, immutable")
        elif path.startswith("/api/media/"):
            response.headers.setdefault("Cache-Control", "private, max-age=604800, stale-while-revalidate=86400")
        elif path == "/health":
            response.headers.setdefault("Cache-Control", "no-store")
        elif path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "private, no-cache, max-age=0, must-revalidate")
        else:
            response.headers.setdefault("Cache-Control", "public, max-age=300")
        return response

    app.include_router(ws_router)
    app.include_router(api_router, prefix="/api")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name}

    return app


app = create_app()
