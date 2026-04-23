import React from "react";
import ReactDOM from "react-dom/client";
import { Gamepad2, Home, LogOut, MessageCircle, Newspaper, Settings, Users } from "lucide-react";

import { confirmEmail, login, register } from "../api/auth";
import { registerDevice } from "../api/devices";
import { getMe, type CurrentUser } from "../api/users";
import { createDeviceKeyBundle, fingerprintPublicKey } from "../crypto/devices";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import "../styles/globals.css";

type AuthMode = "login" | "register" | "confirm";

const friends = ["Nikitin", "Vega", "Mira", "Zero", "RiotKid"];

function App() {
  const [session, setSession] = React.useState<Session | null>(() => loadSession());
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [pendingEmail, setPendingEmail] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = React.useState("Ключи устройства еще не созданы");
  const [deviceFingerprint, setDeviceFingerprint] = React.useState<string | null>(null);

  async function handleAuthenticated(token: string, cloudPassword: string) {
    const user = await getMe(token);
    const nextSession = { token, user };
    saveSession(nextSession);
    setSession(nextSession);
    await createAndRegisterDevice(token, cloudPassword);
  }

  async function createAndRegisterDevice(token: string, cloudPassword: string) {
    setDeviceStatus("Генерируем ключи локально...");
    const bundle = await createDeviceKeyBundle("Windows Desktop", cloudPassword);
    await registerDevice(token, bundle);
    const fingerprint = await fingerprintPublicKey(bundle.publicKey);
    setDeviceFingerprint(fingerprint);
    setDeviceStatus("Устройство зарегистрировано, приватный ключ зашифрован облачным паролем");
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setDeviceFingerprint(null);
    setDeviceStatus("Ключи устройства еще не созданы");
  }

  if (!session) {
    return (
      <AuthShell>
        {authMode === "login" ? (
          <LoginForm onLogin={handleAuthenticated} onSwitch={() => setAuthMode("register")} />
        ) : null}
        {authMode === "register" ? (
          <RegisterForm
            onRegistered={(email, code) => {
              setPendingEmail(email);
              setDevCode(code);
              setAuthMode("confirm");
            }}
            onSwitch={() => setAuthMode("login")}
          />
        ) : null}
        {authMode === "confirm" ? (
          <ConfirmForm
            defaultEmail={pendingEmail}
            devCode={devCode}
            onConfirmed={() => setAuthMode("login")}
            onSwitch={() => setAuthMode("login")}
          />
        ) : null}
      </AuthShell>
    );
  }

  return (
    <Dashboard
      session={session}
      deviceStatus={deviceStatus}
      deviceFingerprint={deviceFingerprint}
      onLogout={handleLogout}
      onCreateDeviceKeys={(cloudPassword) => createAndRegisterDevice(session.token, cloudPassword)}
    />
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">FC</div>
        <h1>FrCenter</h1>
        <p>Вход в игровой E2EE-центр для друзей, чатов и новостей.</p>
        {children}
      </section>
    </main>
  );
}

function LoginForm({
  onLogin,
  onSwitch,
}: {
  onLogin: (token: string, cloudPassword: string) => Promise<void>;
  onSwitch: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [cloudPassword, setCloudPassword] = React.useState("");
  const [status, setStatus] = React.useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Входим...");
    try {
      const response = await login(email, password);
      await onLogin(response.access_token, cloudPassword);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось войти");
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
      </label>
      <label>
        Пароль
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
      </label>
      <label>
        Облачный пароль
        <input
          value={cloudPassword}
          onChange={(event) => setCloudPassword(event.target.value)}
          type="password"
          required
        />
      </label>
      <button type="submit">Войти</button>
      <button className="link-button" onClick={onSwitch} type="button">
        Создать аккаунт
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function RegisterForm({
  onRegistered,
  onSwitch,
}: {
  onRegistered: (email: string, devCode: string | null) => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [cloudPassword, setCloudPassword] = React.useState("");
  const [status, setStatus] = React.useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Создаем аккаунт...");
    try {
      const response = await register({
        email,
        username,
        password,
        cloud_password: cloudPassword,
      });
      onRegistered(response.email, response.dev_confirmation_code ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось зарегистрироваться");
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
      </label>
      <label>
        Username
        <input value={username} onChange={(event) => setUsername(event.target.value)} required />
      </label>
      <label>
        Пароль
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
      </label>
      <label>
        Облачный пароль
        <input
          value={cloudPassword}
          onChange={(event) => setCloudPassword(event.target.value)}
          type="password"
          required
        />
      </label>
      <button type="submit">Зарегистрироваться</button>
      <button className="link-button" onClick={onSwitch} type="button">
        Уже есть аккаунт
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function ConfirmForm({
  defaultEmail,
  devCode,
  onConfirmed,
  onSwitch,
}: {
  defaultEmail: string;
  devCode: string | null;
  onConfirmed: () => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = React.useState(defaultEmail);
  const [code, setCode] = React.useState(devCode ?? "");
  const [status, setStatus] = React.useState(devCode ? `Dev-код: ${devCode}` : "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Подтверждаем...");
    try {
      await confirmEmail(email, code);
      setStatus("Email подтвержден, можно войти");
      onConfirmed();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось подтвердить email");
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
      </label>
      <label>
        Код подтверждения
        <input value={code} onChange={(event) => setCode(event.target.value)} required />
      </label>
      <button type="submit">Подтвердить</button>
      <button className="link-button" onClick={onSwitch} type="button">
        Вернуться ко входу
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </form>
  );
}

function Dashboard({
  session,
  deviceStatus,
  deviceFingerprint,
  onLogout,
  onCreateDeviceKeys,
}: {
  session: Session;
  deviceStatus: string;
  deviceFingerprint: string | null;
  onLogout: () => void;
  onCreateDeviceKeys: (cloudPassword: string) => Promise<void>;
}) {
  const [cloudPassword, setCloudPassword] = React.useState("");

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">FC</div>
        <button aria-label="Главная"><Home size={20} /></button>
        <button aria-label="Чаты"><MessageCircle size={20} /></button>
        <button aria-label="Друзья"><Users size={20} /></button>
        <button aria-label="Лента"><Newspaper size={20} /></button>
        <button aria-label="Игры"><Gamepad2 size={20} /></button>
        <button aria-label="Настройки"><Settings size={20} /></button>
      </aside>

      <section className="content">
        <header className="topbar">
          <p>Добро пожаловать, <strong>{session.user.username.toUpperCase()}</strong></p>
          <div className="topbar-actions">
            <input placeholder="Поиск" />
            <button aria-label="Выйти" onClick={onLogout} type="button"><LogOut size={18} /></button>
          </div>
        </header>

        <section className="hero">
          <div>
            <span>Популярное</span>
            <h1>FrCenter</h1>
            <p>Игровой чат, друзья, группы, новости и сквозное шифрование.</p>
          </div>
        </section>

        <section className="grid">
          <article>
            <h2>Чаты</h2>
            <p>Личные и групповые E2EE-чаты через WebSocket.</p>
          </article>
          <article>
            <h2>Лента</h2>
            <p>Посты друзей, комментарии, реакции и игровые статусы.</p>
          </article>
          <article>
            <h2>Статистика</h2>
            <p>Steam и Riot появятся первыми, Epic и EA позже.</p>
          </article>
          <article>
            <h2>E2EE</h2>
            <p>{deviceStatus}</p>
            {deviceFingerprint ? <small>Fingerprint: {deviceFingerprint}</small> : null}
            <input
              className="compact-input"
              placeholder="Облачный пароль"
              value={cloudPassword}
              onChange={(event) => setCloudPassword(event.target.value)}
              type="password"
            />
            <button
              className="inline-action"
              disabled={!cloudPassword}
              onClick={() => onCreateDeviceKeys(cloudPassword)}
              type="button"
            >
              Обновить ключи
            </button>
          </article>
        </section>
      </section>

      <aside className="friends">
        {friends.map((friend) => (
          <div className="friend" key={friend}>
            <div>{friend.slice(0, 1)}</div>
            <span>{friend}</span>
          </div>
        ))}
      </aside>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
