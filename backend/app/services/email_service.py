from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings


class EmailService:
    async def send_confirmation_code(self, email: str, code: str) -> None:
        if settings.smtp_password == "your_app_password":
            return

        message = EmailMessage()
        message["From"] = settings.smtp_from
        message["To"] = email
        message["Subject"] = "Код подтверждения FrCenter"
        message.set_content(
            "Привет!\n\n"
            f"Код подтверждения FrCenter: {code}\n\n"
            "Если ты не регистрировался во FrCenter, просто проигнорируй это письмо.\n"
        )

        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_ssl,
        )


email_service = EmailService()
