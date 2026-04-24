from fastapi import APIRouter

from app.api import auth, chats, devices, feed, friends, games, media, notifications, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(friends.router, prefix="/friends", tags=["friends"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(chats.router, prefix="/chats", tags=["chats"])
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
api_router.include_router(feed.router, prefix="/feed", tags=["feed"])
api_router.include_router(games.router, prefix="/games", tags=["games"])
