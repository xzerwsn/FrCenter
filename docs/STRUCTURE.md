# Структура проекта

```text
FrCenter/
  backend/
    app/
      main.py
      core/
      db/
      models/
      schemas/
      api/
      services/
      integrations/
      tasks/
      storage/
    tests/
    requirements.txt
  frontend/
    src/
      app/
      pages/
      components/
      crypto/
      api/
      styles/
    package.json
  desktop/
    src-tauri/
  docs/
  scripts/
```

## Backend

FastAPI отвечает за учетные записи, дружбу, чаты, WebSocket, медиа, ленту и игровые интеграции. Сервер не расшифровывает сообщения.

## Frontend

React-приложение содержит общий интерфейс для браузера и desktop-обертки. Клиент отвечает за генерацию ключей, шифрование и расшифровку.

## Desktop

Tauri использует тот же frontend и собирает приложение под Windows и macOS.
