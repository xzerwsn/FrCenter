import React from "react";
import ReactDOM from "react-dom/client";
import {
  Bell,
  ChevronDown,
  Gamepad2,
  Home,
  LogOut,
  MessageCircle,
  PlaySquare,
  Settings,
  UserRound,
  Users,
} from "lucide-react";

import { confirmEmail, login, register } from "../api/auth";
import {
  type Chat,
  type Message,
  addGroupMember,
  createDirectChat,
  createGroupChat,
  deleteChatMessage,
  listChatMessages,
  listChats,
  removeGroupMember,
  sendChatMessage,
  updateChatMessage,
  updateGroupMemberRole,
} from "../api/chats";
import { registerDevice } from "../api/devices";
import { addFriendByCode, createInviteCode, listFriends, searchUsers, sendFriendRequest } from "../api/friends";
import { uploadEncryptedMedia } from "../api/media";
import { connectRealtime, type RealtimeEvent } from "../api/realtime";
import { getMe, type CurrentUser, type UserPublic } from "../api/users";
import { createDeviceKeyBundle, fingerprintPublicKey } from "../crypto/devices";
import {
  createSharedMessageKey,
  decryptBytesWithSharedKey,
  decryptTextWithSharedKey,
  encryptBytesForSharedKey,
  encryptTextForSharedKey,
} from "../crypto/messages";
import { bytesToBase64 } from "../crypto/encoding";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import "../styles/globals.css";

type AuthMode = "login" | "register" | "confirm";
type DashboardSection = "profile" | "home" | "chats" | "friends" | "notifications" | "games" | "clips" | "settings";

const CHAT_KEY_PREFIX = "frcenter.chatKey.";

type MessageContextMenuState = {
  message: Message;
  x: number;
  y: number;
};

function App() {
  const [session, setSession] = React.useState<Session | null>(() => loadSession());
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [pendingEmail, setPendingEmail] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);

  async function handleAuthenticated(token: string, cloudPassword: string) {
    const user = await getMe(token);
    const nextSession = { token, user };
    saveSession(nextSession);
    setSession(nextSession);
    await createAndRegisterDevice(token, cloudPassword);
  }

  async function createAndRegisterDevice(token: string, cloudPassword: string) {
    const bundle = await createDeviceKeyBundle("Windows Desktop", cloudPassword);
    await registerDevice(token, bundle);
    await fingerprintPublicKey(bundle.publicKey);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
  }

  if (!session) {
    return (
      <AuthShell>
        {authMode === "login" ? <LoginForm onLogin={handleAuthenticated} onSwitch={() => setAuthMode("register")} /> : null}
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
      onLogout={handleLogout}
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
        <input value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} type="password" required />
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
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [friends, setFriends] = React.useState<UserPublic[]>([]);
  const [section, setSection] = React.useState<DashboardSection>("home");
  const [selectedProfile, setSelectedProfile] = React.useState<UserPublic | CurrentUser | null>(null);

  React.useEffect(() => {
    void listFriends(session.token).then((response) => setFriends(response.friends));
  }, [session.token]);

  function openOwnProfile() {
    setSelectedProfile(session.user);
    setSection("profile");
  }

  function openFriendProfile(friend: UserPublic) {
    setSelectedProfile(friend);
    setSection("profile");
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <button
          aria-label="Профиль"
          className={`profile-button ${section === "profile" ? "active" : ""}`}
          onClick={openOwnProfile}
          type="button"
        >
          <div className="brand">{session.user.username.slice(0, 1).toUpperCase()}</div>
        </button>
        <button aria-label="Главная" className={section === "home" ? "active" : ""} onClick={() => setSection("home")} type="button">
          <Home size={20} />
        </button>
        <button aria-label="Чаты" className={section === "chats" ? "active" : ""} onClick={() => setSection("chats")} type="button">
          <MessageCircle size={20} />
        </button>
        <button aria-label="Друзья" className={section === "friends" ? "active" : ""} onClick={() => setSection("friends")} type="button">
          <Users size={20} />
        </button>
        <button
          aria-label="Уведомления"
          className={section === "notifications" ? "active" : ""}
          onClick={() => setSection("notifications")}
          type="button"
        >
          <Bell size={20} />
        </button>
        <button aria-label="Игровая зона" className={section === "games" ? "active" : ""} onClick={() => setSection("games")} type="button">
          <Gamepad2 size={20} />
        </button>
        <button aria-label="Клипы" className={section === "clips" ? "active" : ""} onClick={() => setSection("clips")} type="button">
          <PlaySquare size={20} />
        </button>
        <button
          aria-label="Настройки"
          className={section === "settings" ? "active" : ""}
          onClick={() => setSection("settings")}
          type="button"
        >
          <Settings size={20} />
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <p>
            Добро пожаловать, <strong>{session.user.username.toUpperCase()}</strong>
          </p>
          <div className="topbar-actions">
            <input placeholder="Поиск" />
            <button aria-label="Выйти" onClick={onLogout} type="button">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {section === "profile" ? <ProfilePanel profile={selectedProfile ?? session.user} /> : null}
        {section === "home" ? <HomePanel friends={friends} /> : null}
        {section === "chats" ? <ChatsPanel token={session.token} me={session.user} friends={friends} /> : null}
        {section === "friends" ? (
          <FriendsPanel token={session.token} onFriendsChanged={setFriends} onOpenProfile={openFriendProfile} />
        ) : null}
        {section === "notifications" ? <NotificationsPanel /> : null}
        {section === "games" ? <GamesPanel friends={friends} /> : null}
        {section === "clips" ? <ClipsPanel friends={friends} /> : null}
        {section === "settings" ? <SettingsPanel /> : null}
      </section>

      <aside className="friends">
        {friends.map((friend) => (
          <button className="friend" key={friend.id} onClick={() => openFriendProfile(friend)} type="button">
            <div>{friend.username.slice(0, 1).toUpperCase()}</div>
            <span>{friend.username}</span>
          </button>
        ))}
      </aside>
    </main>
  );
}

function ProfilePanel({ profile }: { profile: UserPublic | CurrentUser }) {
  const game = profile.current_game ?? "Не играет";
  const status = profile.status || "offline";
  return (
    <section className="tool-band">
      <div>
        <h2>Профиль</h2>
        <div className="result-row">
          <span>
            <b>{profile.username}</b> · {status}
          </span>
          <UserRound size={18} />
        </div>
        <p className="form-status">Текущая игра: {game}</p>
      </div>
      <div>
        <h2>Общее</h2>
        {"email" in profile ? <p className="form-status">Email: {profile.email}</p> : null}
        <p className="form-status">ID: {profile.id}</p>
      </div>
    </section>
  );
}

function HomePanel({ friends }: { friends: UserPublic[] }) {
  return (
    <section className="tool-band single-column">
      <div>
        <h2>Главная</h2>
        <div className="result-list">
          {friends.length === 0 ? <p className="form-status">Пока нет друзей</p> : null}
          {friends.map((friend) => (
            <div className="result-row" key={friend.id}>
              <span>{friend.username}</span>
              <span className={`status-pill status-${normalizeStatus(friend.status)}`}>{humanizeStatus(friend.status)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NotificationsPanel() {
  return (
    <section className="tool-band single-column">
      <div>
        <h2>Уведомления</h2>
        <div className="result-list">
          <div className="result-row">
            <span>Новых уведомлений пока нет</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function GamesPanel({ friends }: { friends: UserPublic[] }) {
  return (
    <section className="tool-band">
      <div>
        <h2>Игровая зона</h2>
        <p className="form-status">Steam и Riot: настройка интеграций будет в этом разделе.</p>
        <div className="result-list">
          {friends.map((friend) => (
            <div className="result-row" key={friend.id}>
              <span>{friend.username}</span>
              <span>{friend.current_game ?? "Не играет"}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2>Интеграции</h2>
        <div className="result-list">
          <div className="result-row">
            <span>Steam</span>
            <button type="button">Подключить</button>
          </div>
          <div className="result-row">
            <span>Riot Games</span>
            <button type="button">Подключить</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClipsPanel({ friends }: { friends: UserPublic[] }) {
  return (
    <section className="tool-band single-column">
      <div>
        <h2>Клипы</h2>
        <p className="form-status">Медиа-посты друзей (видео/фото) будут отображаться здесь.</p>
        <div className="result-list">
          {friends.slice(0, 6).map((friend) => (
            <div className="result-row" key={friend.id}>
              <span>{friend.username}</span>
              <span>Публикаций: 0</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPanel({
}: {
}) {
  const [darkTheme, setDarkTheme] = React.useState(true);
  const [autoStart, setAutoStart] = React.useState(false);
  const [notifEnabled, setNotifEnabled] = React.useState(true);

  return (
    <section className="tool-band">
      <div>
        <h2>Настройки</h2>
        <div className="result-list">
          <label className="result-row">
            <span>Темная тема</span>
            <input checked={darkTheme} onChange={() => setDarkTheme((v) => !v)} type="checkbox" />
          </label>
          <label className="result-row">
            <span>Запуск вместе с Windows</span>
            <input checked={autoStart} onChange={() => setAutoStart((v) => !v)} type="checkbox" />
          </label>
          <label className="result-row">
            <span>Уведомления</span>
            <input checked={notifEnabled} onChange={() => setNotifEnabled((v) => !v)} type="checkbox" />
          </label>
        </div>
      </div>
      <div>
        <h2>Безопасность</h2>
        <p className="form-status">Сквозное шифрование работает автоматически.</p>
        <p className="form-status">Ключи создаются и обновляются без ручных действий пользователя.</p>
      </div>
    </section>
  );
}

function FriendsPanel({
  token,
  onFriendsChanged,
  onOpenProfile,
}: {
  token: string;
  onFriendsChanged: (friends: UserPublic[]) => void;
  onOpenProfile: (friend: UserPublic) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<UserPublic[]>([]);
  const [friends, setFriends] = React.useState<UserPublic[]>([]);
  const [inviteCode, setInviteCode] = React.useState("");
  const [joinCode, setJoinCode] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    void refreshFriends();
    void loadInviteCode();
  }, [token]);

  async function refreshFriends() {
    const response = await listFriends(token);
    setFriends(response.friends);
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
      await refreshFriends();
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

  async function loadInviteCode() {
    try {
      const response = await createInviteCode(token);
      setInviteCode(response.code);
    } catch {
      // Keep the rest of the panel usable even if invite call fails.
    }
  }

  async function handleCopyInviteCode() {
    if (!inviteCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteCode);
      setStatus("Код скопирован");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось скопировать код");
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
          <input placeholder="Username" value={query} onChange={(event) => setQuery(event.target.value)} required />
          <button type="submit">Найти</button>
        </form>
        <div className="result-list">
          {friends.map((friend) => (
            <div className="result-row" key={friend.id}>
              <span>{friend.username}</span>
              <button onClick={() => onOpenProfile(friend)} type="button">
                Профиль
              </button>
            </div>
          ))}
        </div>
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
        {inviteCode ? (
          <div className="invite-code-row">
            <small className="invite-code">{inviteCode}</small>
            <button className="inline-action" onClick={handleCopyInviteCode} type="button">
              Скопировать
            </button>
          </div>
        ) : null}
        <form className="inline-form stacked" onSubmit={handleAddByCode}>
          <input placeholder="Код друга" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} required />
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
  const [attachmentFile, setAttachmentFile] = React.useState<File | null>(null);
  const [decodeMap, setDecodeMap] = React.useState<Record<string, string>>({});
  const [directUsername, setDirectUsername] = React.useState("");
  const [groupTitle, setGroupTitle] = React.useState("");
  const [groupUsernames, setGroupUsernames] = React.useState<string[]>([]);
  const [memberUsername, setMemberUsername] = React.useState("");
  const [directDropdownOpen, setDirectDropdownOpen] = React.useState(false);
  const [groupDropdownOpen, setGroupDropdownOpen] = React.useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<MessageContextMenuState | null>(null);
  const [previewMediaUrl, setPreviewMediaUrl] = React.useState<string | null>(null);
  const [previewMediaType, setPreviewMediaType] = React.useState<string>("");
  const [status, setStatus] = React.useState("");
  const directDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const groupDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;
  const myMember = selectedChat?.members.find((member) => member.user.id === me.id) ?? null;
  const canManageMembers = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const canManageRoles = selectedChat?.type === "group" && myMember?.role === "owner";
  const canModerateAllMessages = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const scrollToBottom = React.useCallback(() => {
    const messageListElement = messageListRef.current;
    if (!messageListElement) {
      return;
    }
    requestAnimationFrame(() => {
      messageListElement.scrollTop = messageListElement.scrollHeight;
    });
  }, []);

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
      if (event.type === "message.new") {
        const incoming = event.message as Message;
        if (incoming.chat_id === selectedChatId) {
          setMessages((previous) => (previous.some((item) => item.id === incoming.id) ? previous : [...previous, incoming]));
        }
        void reloadChats();
        return;
      }

      if (event.type === "message.updated") {
        const incoming = event.message as Message;
        if (incoming.chat_id === selectedChatId) {
          setMessages((previous) => previous.map((item) => (item.id === incoming.id ? incoming : item)));
        }
        return;
      }

      if (event.type === "message.deleted") {
        if (event.chat_id === selectedChatId) {
          const deletedId = typeof event.message_id === "string" ? event.message_id : "";
          if (deletedId) {
            setMessages((previous) => previous.filter((item) => item.id !== deletedId));
          }
        }
        return;
      }
    });
    return () => socket.close();
  }, [selectedChatId, token]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const targetNode = event.target as Node;
      if (directDropdownRef.current && !directDropdownRef.current.contains(targetNode)) {
        setDirectDropdownOpen(false);
      }
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(targetNode)) {
        setGroupDropdownOpen(false);
      }
      setContextMenu(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  React.useEffect(() => {
    void decodeMessages(messages);
  }, [messages, selectedChatId]);

  React.useEffect(() => {
    if (selectedChat?.type !== "group") {
      setGroupSettingsOpen(false);
    }
  }, [selectedChat?.type]);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages.length, selectedChatId, scrollToBottom]);

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
        decoded[message.id] = await decryptTextWithSharedKey({ ciphertext: message.ciphertext, nonce: message.nonce }, key);
      } catch {
        decoded[message.id] = message.ciphertext;
      }
    }
    setDecodeMap(decoded);
  }

  function toggleGroupUsername(username: string) {
    setGroupUsernames((current) => {
      if (current.includes(username)) {
        return current.filter((item) => item !== username);
      }
      return [...current, username];
    });
  }

  function canManageMessage(message: Message): boolean {
    if (canModerateAllMessages) {
      return true;
    }
    return message.sender.id === me.id;
  }

  async function handleEditMessage(message: Message) {
    if (!selectedChatId || !canManageMessage(message)) {
      return;
    }
    const currentText = decodeMap[message.id] ?? "";
    const nextText = window.prompt("Новое сообщение", currentText);
    if (nextText === null) {
      return;
    }
    const trimmed = nextText.trim();
    if (!trimmed) {
      setStatus("Текст сообщения не может быть пустым");
      return;
    }
    try {
      const key = await ensureChatKey(selectedChatId);
      const encrypted = await encryptTextForSharedKey(trimmed, key);
      await updateChatMessage(token, selectedChatId, message.id, {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        message_type: "text",
      });
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отредактировать сообщение");
    }
  }

  async function handleDeleteMessage(message: Message) {
    if (!selectedChatId || !canManageMessage(message)) {
      return;
    }
    if (!window.confirm("Удалить это сообщение?")) {
      return;
    }
    try {
      await deleteChatMessage(token, selectedChatId, message.id);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить сообщение");
    }
  }

  async function handleCreateDirect(event: React.FormEvent) {
    event.preventDefault();
    if (!directUsername.trim()) {
      setStatus("Выбери друга");
      return;
    }
    setStatus("Создаем direct-чат...");
    try {
      const chat = await createDirectChat(token, directUsername.trim());
      setDirectUsername("");
      setDirectDropdownOpen(false);
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
      const usernames = Array.from(new Set(groupUsernames.map((item) => item.trim()).filter((item) => item.length > 0)));
      if (usernames.length === 0) {
        setStatus("Выбери хотя бы одного друга");
        return;
      }
      const chat = await createGroupChat(token, { title: groupTitle.trim(), usernames });
      setGroupTitle("");
      setGroupUsernames([]);
      setGroupDropdownOpen(false);
      await ensureChatKey(chat.id);
      await reloadChats();
      setSelectedChatId(chat.id);
      setStatus("Групповой чат готов");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать групповой чат");
    }
  }

  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }
    setStatus("Добавляем участника...");
    try {
      const rotatedKey = await createSharedMessageKey();
      await addGroupMember(token, selectedChatId, memberUsername.trim(), rotatedKey);
      localStorage.setItem(`${CHAT_KEY_PREFIX}${selectedChatId}`, rotatedKey);
      setMemberUsername("");
      await reloadChats();
      setStatus("Участник добавлен");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось добавить участника");
    }
  }

  async function handleRoleChange(userId: string, role: "admin" | "member") {
    if (!selectedChatId) {
      return;
    }
    setStatus("Обновляем роль...");
    try {
      await updateGroupMemberRole(token, selectedChatId, { user_id: userId, role });
      await reloadChats();
      setStatus("Роль обновлена");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить роль");
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedChatId) {
      return;
    }
    setStatus("Удаляем участника...");
    try {
      const rotatedKey = await createSharedMessageKey();
      await removeGroupMember(token, selectedChatId, userId, rotatedKey);
      localStorage.setItem(`${CHAT_KEY_PREFIX}${selectedChatId}`, rotatedKey);
      await reloadChats();
      setStatus("Участник удален");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить участника");
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
      await sendChatMessage(token, selectedChatId, {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        message_type: "text",
      });
      setMessageText("");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    }
  }

  async function handleSendAttachment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId || !attachmentFile) {
      return;
    }
    setStatus("Шифруем и отправляем вложение...");
    try {
      const chatKey = await ensureChatKey(selectedChatId);
      const fileBytes = new Uint8Array(await attachmentFile.arrayBuffer());
      const encryptedFile = await encryptBytesForSharedKey(fileBytes, chatKey);
      const encryptedBuffer = new ArrayBuffer(encryptedFile.ciphertextBytes.byteLength);
      new Uint8Array(encryptedBuffer).set(encryptedFile.ciphertextBytes);
      const encryptedBlob = new Blob([encryptedBuffer], { type: "application/octet-stream" });
      const encryptedFileObject = new File([encryptedBlob], `${attachmentFile.name}.enc`, { type: "application/octet-stream" });
      const media = await uploadEncryptedMedia(token, selectedChatId, encryptedFileObject);
      const encryptedPayload = await encryptTextForSharedKey(
        JSON.stringify({
          kind: "media",
          media_id: media.media_id,
          media_url: media.media_url,
          file_name: attachmentFile.name,
          file_size: attachmentFile.size,
          file_mime: attachmentFile.type || "application/octet-stream",
          file_nonce: encryptedFile.nonce,
        }),
        chatKey,
      );
      await sendChatMessage(token, selectedChatId, {
        ciphertext: encryptedPayload.ciphertext,
        nonce: encryptedPayload.nonce,
        message_type: "media",
      });
      setAttachmentFile(null);
      setStatus("Вложение отправлено");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить вложение");
    }
  }

  return (
    <section className={`chat-band ${selectedChat?.type === "direct" ? "direct-full-height" : ""}`}>
      <div className="chat-list-pane">
        <h2>Чаты</h2>
        <form className="inline-form" onSubmit={handleCreateDirect}>
          <div className="friend-select" ref={directDropdownRef}>
            <button className="friend-select-trigger" onClick={() => setDirectDropdownOpen((open) => !open)} type="button">
              <span>{directUsername || "Username друга"}</span>
              <ChevronDown size={16} />
            </button>
            <div className={`friend-select-dropdown ${directDropdownOpen ? "open" : ""}`}>
              {friends.map((friend) => (
                <button
                  className="friend-select-item"
                  key={friend.id}
                  onClick={() => {
                    setDirectUsername(friend.username);
                    setDirectDropdownOpen(false);
                  }}
                  type="button"
                >
                  {friend.username}
                </button>
              ))}
            </div>
          </div>
          <button type="submit">Direct</button>
        </form>
        <form className="inline-form stacked" onSubmit={handleCreateGroup}>
          <input placeholder="Название группы" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} minLength={1} maxLength={120} required />
          <div className="friend-select" ref={groupDropdownRef}>
            <button className="friend-select-trigger" onClick={() => setGroupDropdownOpen((open) => !open)} type="button">
              <span>{groupUsernames.length > 0 ? groupUsernames.join(", ") : "Username друга"}</span>
              <ChevronDown size={16} />
            </button>
            <div className={`friend-select-dropdown ${groupDropdownOpen ? "open" : ""}`}>
              {friends.map((friend) => (
                <label className="friend-select-item friend-select-check" key={friend.id}>
                  <input checked={groupUsernames.includes(friend.username)} onChange={() => toggleGroupUsername(friend.username)} type="checkbox" />
                  <span>{friend.username}</span>
                </label>
              ))}
            </div>
          </div>
          <button type="submit">Создать группу</button>
        </form>
        <div className="chat-list">
          {chats.map((chat) => (
            <button className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`} key={chat.id} onClick={() => setSelectedChatId(chat.id)} type="button">
              <strong>{chat.type === "group" ? chat.title ?? "Группа" : "Direct chat"}</strong>
              <span>{chat.members.length} участника</span>
            </button>
          ))}
        </div>
      </div>

      <div className="chat-pane">
        <h2>Сообщения</h2>
        {selectedChat?.type === "group" ? (
          <div className="chat-settings">
            <button className="chat-settings-toggle" onClick={() => setGroupSettingsOpen((open) => !open)} type="button">
              Настройки чата
              <ChevronDown className={groupSettingsOpen ? "rotated" : ""} size={16} />
            </button>
            <div className={`chat-settings-panel ${groupSettingsOpen ? "open" : ""}`}>
              <div className="result-list">
                <p className="form-status">Моя роль: {myMember?.role ?? "member"}</p>
                {canManageMembers ? (
                  <form className="inline-form" onSubmit={handleAddMember}>
                    <input
                      placeholder="Username участника"
                      value={memberUsername}
                      onChange={(event) => setMemberUsername(event.target.value)}
                      minLength={3}
                      maxLength={32}
                      required
                    />
                    <button type="submit">Добавить</button>
                  </form>
                ) : null}
                {selectedChat.members.map((member) => (
                  <div className="result-row" key={member.user.id}>
                    <span>
                      {member.user.username} ({member.role})
                    </span>
                    {canManageRoles && member.role !== "owner" ? (
                      <button onClick={() => handleRoleChange(member.user.id, member.role === "admin" ? "member" : "admin")} type="button">
                        {member.role === "admin" ? "Снять admin" : "Сделать admin"}
                      </button>
                    ) : null}
                    {canManageMembers && member.role !== "owner" ? (
                      <button onClick={() => handleRemoveMember(member.user.id)} type="button">
                        Удалить
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="message-list" ref={messageListRef}>
          {messages.map((message) => (
            <div
              className={`message ${message.sender.id === me.id ? "mine" : ""}`}
              key={message.id}
              onContextMenu={(event) => {
                if (!canManageMessage(message)) {
                  return;
                }
                event.preventDefault();
                setContextMenu({
                  message,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <div className="message-head">
                <div className="message-author">
                  <div className="message-avatar">
                    {message.sender.avatar_url ? (
                      <img alt={message.sender.username} src={message.sender.avatar_url} />
                    ) : (
                      message.sender.username.slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <b>{message.sender.username}</b>
                </div>
                <time>{formatMessageTime(message.created_at)}</time>
              </div>
              {message.message_type === "media" ? (
                <MediaMessageView
                  chatId={selectedChatId}
                  onMediaReady={scrollToBottom}
                  onPreview={(url, mediaType) => {
                    setPreviewMediaUrl(url);
                    setPreviewMediaType(mediaType);
                  }}
                  raw={decodeMap[message.id] ?? ""}
                  token={token}
                />
              ) : (
                <p>{decodeMap[message.id] ?? "..."}</p>
              )}
            </div>
          ))}
        </div>
        {contextMenu ? (
          <div
            className="message-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.message.message_type === "text" ? (
              <button
                onClick={() => {
                  void handleEditMessage(contextMenu.message);
                  setContextMenu(null);
                }}
                type="button"
              >
                Редактировать
              </button>
            ) : null}
            <button
              onClick={() => {
                void handleDeleteMessage(contextMenu.message);
                setContextMenu(null);
              }}
              type="button"
            >
              Удалить
            </button>
          </div>
        ) : null}

        <form className="inline-form" onSubmit={handleSendMessage}>
          <input placeholder="Сообщение" value={messageText} onChange={(event) => setMessageText(event.target.value)} required />
          <button disabled={!selectedChatId} type="submit">
            Отправить
          </button>
        </form>
        <form className="inline-form" onSubmit={handleSendAttachment}>
          <input accept="*/*" onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)} type="file" />
          <button disabled={!selectedChatId || !attachmentFile} type="submit">
            Отправить файл
          </button>
        </form>
        {status ? <p className="form-status">{status}</p> : null}
        {previewMediaUrl ? (
          <div
            className="media-preview-overlay"
            onClick={() => {
              setPreviewMediaUrl(null);
              setPreviewMediaType("");
            }}
            role="button"
            tabIndex={0}
          >
            <div className="media-preview-dialog" onClick={(event) => event.stopPropagation()}>
              {previewMediaType.startsWith("video/") ? (
                <video className="media-preview-view" controls src={previewMediaUrl} />
              ) : previewMediaType.startsWith("image/") ? (
                <img alt="Медиа" className="media-preview-view" src={previewMediaUrl} />
              ) : (
                <a className="inline-action" href={previewMediaUrl} rel="noreferrer" target="_blank">
                  Открыть файл в новой вкладке
                </a>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MediaMessageView({
  chatId,
  onMediaReady,
  token,
  raw,
  onPreview,
}: {
  chatId: string;
  onMediaReady: () => void;
  token: string;
  raw: string;
  onPreview: (url: string, mediaType: string) => void;
}) {
  const mediaPayload = parseMediaPayload(raw);
  const [mediaUrl, setMediaUrl] = React.useState<string>("");
  const [mediaError, setMediaError] = React.useState<string>("");

  React.useEffect(() => {
    let active = true;
    let objectUrlToRevoke = "";

    async function resolveMedia() {
      if (!mediaPayload || !chatId) {
        return;
      }
      try {
        const response = await fetch(mediaPayload.media_url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Не удалось загрузить медиа (${response.status})`);
        }
        const encryptedBytes = new Uint8Array(await response.arrayBuffer());
        const chatKey = await ensureChatKey(chatId);
        const decryptedBytes = await decryptBytesWithSharedKey(encryptedBytes, mediaPayload.file_nonce, chatKey);
        const safeBytes = new Uint8Array(decryptedBytes.byteLength);
        safeBytes.set(decryptedBytes);
        const blob = new Blob([safeBytes.buffer], { type: mediaPayload.file_mime || "application/octet-stream" });
        objectUrlToRevoke = URL.createObjectURL(blob);
        if (active) {
          setMediaUrl(objectUrlToRevoke);
          setMediaError("");
          onMediaReady();
        }
      } catch (error) {
        if (active) {
          setMediaError(error instanceof Error ? error.message : "Не удалось показать медиа");
          setMediaUrl("");
        }
      }
    }

    void resolveMedia();
    return () => {
      active = false;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [chatId, mediaPayload?.file_mime, mediaPayload?.file_nonce, mediaPayload?.media_url, onMediaReady, token]);

  if (!mediaPayload) {
    return <p>{raw || "..."}</p>;
  }

  const isImage = mediaPayload.file_mime.startsWith("image/");
  const isVideo = mediaPayload.file_mime.startsWith("video/");
  const isAudio = mediaPayload.file_mime.startsWith("audio/");

  return (
    <div className="media-message">
      {mediaError ? <p>{mediaError}</p> : null}
      {!mediaError && !mediaUrl ? <p>Загружаем медиа...</p> : null}
      {mediaUrl && isImage ? <img alt={mediaPayload.file_name} className="media-inline-preview" src={mediaUrl} /> : null}
      {mediaUrl && isVideo ? <video className="media-inline-preview" controls src={mediaUrl} /> : null}
      {mediaUrl && isAudio ? <audio className="media-inline-audio" controls src={mediaUrl} /> : null}
      <p>
        Файл: {mediaPayload.file_name} ({formatBytes(mediaPayload.file_size)})
      </p>
      {mediaUrl ? (
        <button className="inline-action" onClick={() => onPreview(mediaUrl, mediaPayload.file_mime)} type="button">
          Открыть
        </button>
      ) : null}
    </div>
  );
}

type MediaPayload = {
  kind: "media";
  media_id: string;
  media_url: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  file_nonce: string;
};

function parseMediaPayload(raw: string): MediaPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw) as Partial<MediaPayload>;
    if (payload.kind !== "media" || typeof payload.media_url !== "string" || typeof payload.file_name !== "string") {
      return null;
    }
    return {
      kind: "media",
      media_id: payload.media_id ?? "",
      media_url: payload.media_url,
      file_name: payload.file_name,
      file_size: typeof payload.file_size === "number" ? payload.file_size : 0,
      file_mime: payload.file_mime ?? "application/octet-stream",
      file_nonce: payload.file_nonce ?? "",
    };
  } catch {
    return null;
  }
}

function normalizeStatus(status: string | null | undefined): "online" | "offline" | "dnd" | "away" {
  if (status === "online" || status === "offline" || status === "dnd" || status === "away") {
    return status;
  }
  return "offline";
}

function humanizeStatus(status: string | null | undefined): string {
  const value = normalizeStatus(status);
  if (value === "online") {
    return "в сети";
  }
  if (value === "dnd") {
    return "не беспокоить";
  }
  if (value === "away") {
    return "отошел";
  }
  return "не в сети";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function ensureChatKey(chatId: string): Promise<string> {
  const storageKey = `${CHAT_KEY_PREFIX}${chatId}`;
  const derived = await deriveDeterministicChatKey(chatId);
  if (localStorage.getItem(storageKey) !== derived) {
    localStorage.setItem(storageKey, derived);
  }
  return derived;
}

async function deriveDeterministicChatKey(chatId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`frcenter:${chatId}`));
  return bytesToBase64(new Uint8Array(digest));
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);


