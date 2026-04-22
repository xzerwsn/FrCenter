# Деплой на Windows

## Требования

- Python 3.12+
- PostgreSQL
- Redis
- Node.js LTS

## Общий порядок

1. Установить зависимости.
2. Создать базу PostgreSQL `frcenter`.
3. Скопировать `.env.example` в `.env`.
4. Заполнить секреты в `.env`.
5. Запустить backend.
6. Запустить frontend или собрать production build.
7. Открыть порт в Windows Firewall.
8. Настроить проброс портов на роутере или туннель.

## SMTP

Используйте пароль приложения Mail.ru только в локальном `.env`.
