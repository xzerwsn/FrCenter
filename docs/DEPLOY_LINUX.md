# Деплой на Linux Mint

## Требования

- Python 3.12+
- PostgreSQL
- Redis
- Node.js LTS
- nginx для reverse proxy

## Общий порядок

1. Установить системные зависимости.
2. Создать пользователя и базу PostgreSQL.
3. Скопировать `.env.example` в `.env`.
4. Заполнить секреты в `.env`.
5. Выполнить миграции: `alembic upgrade head`.
6. Запустить backend через systemd.
7. Собрать frontend.
8. Настроить nginx.
9. Подключить HTTPS через домен или туннель.
