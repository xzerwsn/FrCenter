# Windows: тест с другом вне локальной сети (без белого IP)

Ниже быстрый способ для проверки FrCenter через временные туннели Cloudflare.

## 1) Подготовка

1. Убедитесь, что backend и frontend запускаются локально.
2. Установите `cloudflared`:
   - через `winget`: `winget install Cloudflare.cloudflared`
   - или скачайте с сайта Cloudflare.

## 2) Настройка `.env` для CORS

В `C:\tgg\.env` добавьте/обновите:

```env
BACKEND_URL=https://<backend-tunnel-domain>
FRONTEND_ORIGIN_REGEX=^https://.*trycloudflare.com$
```

Где `<backend-tunnel-domain>` подставите после запуска туннеля backend.

## 3) Запуск backend

```powershell
cd C:\tgg\backend
.\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 4) Поднимите туннель для backend (новое окно)

```powershell
cloudflared tunnel --url http://localhost:8000
```

Скопируйте выданный URL вида `https://xxxxx.trycloudflare.com` — это backend URL.

## 5) Запуск frontend c публичным backend URL

В новом окне:

```powershell
cd C:\tgg\frontend
$env:VITE_BACKEND_URL="https://<backend-tunnel-domain>"
npm run dev -- --host localhost --port 5173
```

## 6) Поднимите туннель для frontend (новое окно)

```powershell
cloudflared tunnel --url http://localhost:5173
```

Скопируйте URL frontend и отправьте другу.

## 7) Проверка

1. Друг открывает frontend tunnel URL.
2. Регистрируется/логинится.
3. Проверяете отправку сообщений и realtime в чатах.

---

Важно:
- Туннели `trycloudflare.com` временные: после перезапуска будут новые URL.
- После смены backend tunnel URL снова обновите `BACKEND_URL` в `.env` и `VITE_BACKEND_URL` для frontend.
