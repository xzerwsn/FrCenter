# Deploy на Render через GitHub

Этот сценарий развертывает:
- backend (FastAPI),
- frontend (Vite static),
- Postgres,
- Redis-compatible Key Value.

Используется blueprint из файла `render.yaml` в корне репозитория.

## 1) Подготовка GitHub

1. Запушь актуальные изменения в `main` вашего приватного репозитория.
2. Убедись, что в репозитории есть `render.yaml`.

## 2) Создание сервисов на Render

1. Войди в Render через GitHub.
2. Нажми **New +** -> **Blueprint**.
3. Выбери репозиторий `FrCenter`.
4. Render прочитает `render.yaml` и предложит создать 4 ресурса:
   - `frcenter-backend`
   - `frcenter-frontend`
   - `frcenter-db`
   - `frcenter-redis`
5. Нажми **Apply**.

## 3) Обязательные переменные SMTP (backend)

После создания открой сервис `frcenter-backend` -> **Environment** и задай:

- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- при необходимости `SMTP_HOST` и `SMTP_PORT`

Без SMTP регистрация с подтверждением email может не завершаться.

## 4) Важная настройка URL после первого деплоя

После первого успешного деплоя:

1. Открой `frcenter-frontend` и скопируй его реальный URL.
2. Открой `frcenter-backend` -> **Environment** и обнови:
   - `FRONTEND_URL=<реальный frontend URL>`
3. При необходимости уточни `FRONTEND_ORIGIN_REGEX` (обычно `^https://.*onrender.com$` достаточно).
4. Нажми redeploy backend.

## 5) Проверка

1. Открой frontend URL.
2. Зарегистрируй два аккаунта (ты и друг).
3. Проверь:
   - добавление в друзья,
   - создание direct/group чата,
   - обмен сообщениями в realtime.

## Примечания по free-плану

- Free backend может засыпать при простое (первый запрос после простоя медленнее).
- Free Postgres и free Key Value имеют ограничения по объему/срокам.
