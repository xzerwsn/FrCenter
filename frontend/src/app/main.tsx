import React from "react";
import ReactDOM from "react-dom/client";
import { Gamepad2, Home, LogOut, MessageCircle, Newspaper, Settings, Users } from "lucide-react";

import { confirmEmail, login, register } from "../api/auth";
import {
  type Chat,
  type Message,
  createDirectChat,
  createGroupChat,
  listChatMessages,
  listChats,
  sendChatMessage,
} from "../api/chats";
import { registerDevice } from "../api/devices";
import {
  addFriendByCode,
  createInviteCode,
  listFriends,
  searchUsers,
  sendFriendRequest,
} from "../api/friends";
import { connectRealtime, type RealtimeEvent } from "../api/realtime";
import { getMe, type CurrentUser, type UserPublic } from "../api/users";
import { createDeviceKeyBundle, fingerprintPublicKey } from "../crypto/devices";
import { createSharedMessageKey, decryptTextWithSharedKey, encryptTextForSharedKey } from "../crypto/messages";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import "../styles/globals.css";

type AuthMode = "login" | "register" | "confirm";

const CHAT_KEY_PREFIX = "frcenter.chatKey.";

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
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
          title="Только латинские буквы, цифры и _ (3-32 символа)"
          required
        />
      </label>
      <label>
        Пароль
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            minLength={8}
            maxLength={256}
            required
          />
      </label>
      <label>
        Облачный пароль
          <input
            value={cloudPassword}
            onChange={(event) => setCloudPassword(event.target.value)}
            type="password"
            minLength={8}
            maxLength={256}
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
  const [friends, setFriends] = React.useState<UserPublic[]>([]);

  React.useEffect(() => {
    void listFriends(session.token).then((response) => setFriends(response.friends));
  }, [session.token]);

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

        <FriendsPanel token={session.token} onFriendsChanged={setFriends} />
        <ChatsPanel token={session.token} me={session.user} friends={friends} />
      </section>

      <aside className="friends">
        {friends.map((friend) => (
          <div className="friend" key={friend.id}>
            <div>{friend.username.slice(0, 1).toUpperCase()}</div>
            <span>{friend.username}</span>
          </div>
        ))}
      </aside>
    </main>
  );
}

function FriendsPanel({
  token,
  onFriendsChanged,
}: {
  token: string;
  onFriendsChanged: (friends: UserPublic[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<UserPublic[]>([]);
  const [inviteCode, setInviteCode] = React.useState("");
  const [joinCode, setJoinCode] = React.useState("");
  const [status, setStatus] = React.useState("");

  async function refreshFriends() {
    const response = await listFriends(token);
    onFriendsChanged(response.friends);
  }

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Ищем...");
    try {
      const results = await searchUsers(token, query);
      setSearchResults(results);
      setStatus(results.length ? "" : "Никого не нашли");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось найти пользователя");
    }
  }

  async function handleRequest(username: string) {
    setStatus("Отправляем заявку...");
    try {
      await sendFriendRequest(token, username);
      setStatus("Заявка отправлена");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить заявку");
    }
  }

  async function handleCreateInvite() {
    setStatus("Создаем invite-код...");
    try {
      const response = await createInviteCode(token);
      setInviteCode(response.code);
      setStatus("Invite-код готов");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать invite-код");
    }
  }

  async function handleAddByCode(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Добавляем друга...");
    try {
      await addFriendByCode(token, joinCode);
      setJoinCode("");
      await refreshFriends();
      setStatus("Друг добавлен");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось добавить по коду");
    }
  }

  return (
    <section className="tool-band">
      <div>
        <h2>Друзья</h2>
        <form className="inline-form" onSubmit={handleSearch}>
          <input
            placeholder="Username"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
          />
          <button type="submit">Найти</button>
        </form>
        <div className="result-list">
          {searchResults.map((user) => (
            <div className="result-row" key={user.id}>
              <span>{user.username}</span>
              <button onClick={() => handleRequest(user.username)} type="button">
                Заявка
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2>Invite</h2>
        <button className="inline-action" onClick={handleCreateInvite} type="button">
          Создать код
        </button>
        {inviteCode ? <small className="invite-code">{inviteCode}</small> : null}
        <form className="inline-form stacked" onSubmit={handleAddByCode}>
          <input
            placeholder="Код друга"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            required
          />
          <button type="submit">Добавить</button>
        </form>
      </div>
      {status ? <p className="form-status">{status}</p> : null}
    </section>
  );
}

function ChatsPanel({
  token,
  me,
  friends,
}: {
  token: string;
  me: CurrentUser;
  friends: UserPublic[];
}) {
  const [chats, setChats] = React.useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = React.useState<string>("");
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [messageText, setMessageText] = React.useState("");
  const [decodeMap, setDecodeMap] = React.useState<Record<string, string>>({});
  const [directUsername, setDirectUsername] = React.useState("");
  const [groupTitle, setGroupTitle] = React.useState("");
  const [groupUsernames, setGroupUsernames] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    void reloadChats();
  }, [token]);

  React.useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }
    void listChatMessages(token, selectedChatId).then(setMessages);
  }, [selectedChatId, token]);

  React.useEffect(() => {
    const socket = connectRealtime(token, (event: RealtimeEvent) => {
      if (event.type !== "message.new") {
        return;
      }
      const incoming = event.message as Message;
      if (incoming.chat_id === selectedChatId) {
        setMessages((previous) => [...previous, incoming]);
      }
      void reloadChats();
    });

    return () => {
      socket.close();
    };
  }, [selectedChatId, token]);

  React.useEffect(() => {
    void decodeMessages(messages);
  }, [messages]);

  async function reloadChats() {
    const response = await listChats(token);
    setChats(response.chats);
    if (!selectedChatId && response.chats.length > 0) {
      setSelectedChatId(response.chats[0].id);
    }
  }

  async function decodeMessages(items: Message[]) {
    if (!selectedChatId) {
      return;
    }
    const key = await ensureChatKey(selectedChatId);
    const decoded: Record<string, string> = {};
    for (const message of items) {
      try {
        decoded[message.id] = await decryptTextWithSharedKey(
          { ciphertext: message.ciphertext, nonce: message.nonce },
          key,
        );
      } catch {
        decoded[message.id] = message.ciphertext;
      }
    }
    setDecodeMap(decoded);
  }

  async function handleCreateDirect(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Создаем direct-чат...");
    try {
      const chat = await createDirectChat(token, directUsername);
      setDirectUsername("");
      await ensureChatKey(chat.id);
      await reloadChats();
      setSelectedChatId(chat.id);
      setStatus("Direct-чат готов");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать чат");
    }
  }

  async function handleCreateGroup(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Создаем групповой чат...");
    try {
      const usernames = groupUsernames
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      if (usernames.length === 0) {
        setStatus("Укажи хотя бы одного участника через запятую");
        return;
      }

      const uniqueUsernames = Array.from(new Set(usernames));
      const chat = await createGroupChat(token, {
        title: groupTitle.trim(),
        usernames: uniqueUsernames,
      });
      setGroupTitle("");
      setGroupUsernames("");
      await ensureChatKey(chat.id);
      await reloadChats();
      setSelectedChatId(chat.id);
      setStatus("Групповой чат готов");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать групповой чат");
    }
  }

  async function handleSendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }

    setStatus("Отправляем сообщение...");
    try {
      const key = await ensureChatKey(selectedChatId);
      const encrypted = await encryptTextForSharedKey(messageText, key);
      const message = await sendChatMessage(token, selectedChatId, {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        message_type: "text",
      });
      setMessageText("");
      setMessages((previous) => [...previous, message]);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    }
  }

  return (
    <section className="chat-band">
      <div className="chat-list-pane">
        <h2>Чаты</h2>
        <form className="inline-form" onSubmit={handleCreateDirect}>
          <input
            list="friend-options"
            placeholder="Username друга"
            value={directUsername}
            onChange={(event) => setDirectUsername(event.target.value)}
            required
          />
          <datalist id="friend-options">
            {friends.map((friend) => (
              <option key={friend.id} value={friend.username} />
            ))}
          </datalist>
          <button type="submit">Direct</button>
        </form>
        <form className="inline-form stacked" onSubmit={handleCreateGroup}>
          <input
            placeholder="Название группы"
            value={groupTitle}
            onChange={(event) => setGroupTitle(event.target.value)}
            minLength={1}
            maxLength={120}
            required
          />
          <input
            placeholder="Участники: user1, user2"
            value={groupUsernames}
            onChange={(event) => setGroupUsernames(event.target.value)}
            required
          />
          <button type="submit">Создать группу</button>
        </form>
        <div className="chat-list">
          {chats.map((chat) => (
            <button
              className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`}
              key={chat.id}
              onClick={() => setSelectedChatId(chat.id)}
              type="button"
            >
              <strong>{chat.type === "group" ? chat.title ?? "Группа" : "Direct chat"}</strong>
              <span>{chat.members.length} участника</span>
            </button>
          ))}
        </div>
      </div>

      <div className="chat-pane">
        <h2>Сообщения</h2>
        <div className="message-list">
          {messages.map((message) => (
            <div className={`message ${message.sender.id === me.id ? "mine" : ""}`} key={message.id}>
              <b>{message.sender.username}</b>
              <p>{decodeMap[message.id] ?? "..."}</p>
            </div>
          ))}
        </div>
        <form className="inline-form" onSubmit={handleSendMessage}>
          <input
            placeholder="Сообщение"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            required
          />
          <button disabled={!selectedChatId} type="submit">
            Отправить
          </button>
        </form>
        {status ? <p className="form-status">{status}</p> : null}
      </div>
    </section>
  );
}

async function ensureChatKey(chatId: string): Promise<string> {
  const storageKey = `${CHAT_KEY_PREFIX}${chatId}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const nextKey = await createSharedMessageKey();
  localStorage.setItem(storageKey, nextKey);
  return nextKey;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
