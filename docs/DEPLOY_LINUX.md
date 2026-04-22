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
5. Запустить backend через systemd.
6. Собрать frontend.
7. Настроить nginx.
8. Подключить HTTPS через домен или туннель.
