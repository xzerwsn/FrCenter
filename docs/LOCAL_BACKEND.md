# Локальный запуск backend

Эта инструкция нужна для проверки первого auth-среза: регистрация, подтверждение email и логин.

## 1. Python и зависимости

```powershell
cd C:\tgg\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
```

## 2. PostgreSQL

Создайте базу и пользователя:

```sql
CREATE USER frcenter WITH PASSWORD 'password';
CREATE DATABASE frcenter OWNER frcenter;
```

## 3. Переменные окружения

Скопируйте пример:

```powershell
cd C:\tgg
Copy-Item .env.example .env
```

Затем заполните реальные значения в `.env`.

Важно: SMTP-пароль Mail.ru должен быть только в `.env`, не в коде и не в git.

## 4. Миграции

```powershell
cd C:\tgg\backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head
```

## 5. Запуск API

```powershell
cd C:\tgg
.\scripts\start_backend.ps1
```

API будет доступен на:

```text
http://localhost:8000
```

Swagger:

```text
http://localhost:8000/docs
```

## 6. Проверка auth

1. `POST /api/auth/register`
2. В development-режиме код подтверждения вернется в поле `dev_confirmation_code`.
3. `POST /api/auth/confirm-email`
4. `POST /api/auth/login`

После настройки SMTP код также будет отправляться на email.
