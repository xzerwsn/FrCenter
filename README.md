# FrCenter

FrCenter is a Russian-language gaming social messenger prototype with web and desktop clients, end-to-end encrypted chats, friends, groups, a social feed, and future game integrations.

## Stack

- Backend: Python, FastAPI
- Database: PostgreSQL
- Realtime: WebSocket
- Frontend: React, Vite, TypeScript
- Desktop: Tauri
- Crypto: client-side E2EE with libsodium-compatible primitives

## Repository Layout

```text
backend/   FastAPI server, database models, APIs, background tasks
frontend/  React web client shared by browser and desktop shell
desktop/   Tauri wrapper for Windows and macOS builds
docs/      Technical specification, database, security, and deployment notes
scripts/   Local helper scripts
```

## First MVP

1. Registration, login, email confirmation.
2. User profile and username.
3. Friends by username and invite code.
4. Personal E2EE chats.
5. Group E2EE chats.
6. Russian gaming dashboard UI.
7. Web client.
8. Windows desktop build.
9. Home server deployment docs.

## Local Backend

See [docs/LOCAL_BACKEND.md](docs/LOCAL_BACKEND.md) for the first auth API run with PostgreSQL and Alembic migrations.
For testing with a friend outside your local network on Windows, see [docs/WINDOWS_REMOTE_CHAT_TEST.md](docs/WINDOWS_REMOTE_CHAT_TEST.md).
For Render deployment via GitHub, see [docs/DEPLOY_RENDER.md](docs/DEPLOY_RENDER.md).
For Tauri desktop packaging on Windows and backend URL runtime configuration, see [docs/DESKTOP_WINDOWS.md](docs/DESKTOP_WINDOWS.md).

## One-command local start (Windows)

```powershell
cd C:\tgg
.\scripts\start_all.ps1
```

This opens two PowerShell windows: backend on `http://localhost:8000` and frontend on `http://localhost:5173`.

## Security Note

Never commit real secrets. Copy `.env.example` to `.env` on the target server and fill in private values there.
