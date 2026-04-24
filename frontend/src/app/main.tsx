import React from "react";
import ReactDOM from "react-dom/client";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  Copy,
  Gamepad2,
  Home,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  PlaySquare,
  Search,
  Settings,
  UserRound,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { confirmEmail, login, logout, register } from "../api/auth";
import {
  type Chat,
  type Message,
  addGroupMember,
  createDirectChat,
  createGroupChat,
  deleteChatMessage,
  listChatMessages,
  listChats,
  markChatRead,
  removeGroupMember,
  sendChatMessage,
  updateGroupChat,
  updateChatMessage,
  updateGroupMemberRole,
} from "../api/chats";
import { registerDevice } from "../api/devices";
import {
  acceptFriendRequest,
  addFriendByCode,
  createInviteCode,
  declineFriendRequest,
  listFriendRequests,
  listFriends,
  searchUsers,
  sendFriendRequest,
  type FriendRequestResponse,
} from "../api/friends";
import { listFeed, type FeedPublication } from "../api/feed";
import { uploadEncryptedMedia } from "../api/media";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "../api/notifications";
import { connectRealtime, type RealtimeEvent } from "../api/realtime";
import { getMe, updateMe, type CurrentUser, type ProfilePhoto, type UserPublic } from "../api/users";
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
type DashboardSection = "profile" | "home" | "chats" | "friends" | "games" | "clips" | "settings";

const CHAT_KEY_PREFIX = "frcenter.chatKey.";
const CHATS_CACHE_PREFIX = "frcenter.chatsCache.";
const PINNED_CHATS_STORAGE_KEY = "frcenter.pinnedChats";
const HIDDEN_CHATS_STORAGE_KEY = "frcenter.hiddenChats";
const THEME_STORAGE_KEY = "frcenter.siteTheme";
const DASHBOARD_SECTION_STORAGE_KEY = "frcenter.dashboardSection";
const SELECTED_PROFILE_STORAGE_KEY = "frcenter.selectedProfile";
const SELECTED_CHAT_STORAGE_KEY_PREFIX = "frcenter.selectedChat.";
const DEFAULT_NOTIFICATION_SOUND_URL = "https://www.myinstants.com/media/sounds/hell_AJWSn3e.mp3";

type SiteTheme = {
  id: string;
  name: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  secondaryAccent: string;
};

const SITE_THEMES: SiteTheme[] = [
  {
    id: "classic-dark",
    name: "Тёмная",
    background: "#0F1722",
    surface: "#1A2431",
    text: "#F3F7FB",
    accent: "#4C8DFF",
    secondaryAccent: "#8EC5FF",
  },
  {
    id: "classic-light",
    name: "Светлая",
    background: "#F4F7FB",
    surface: "#FFFFFF",
    text: "#18212B",
    accent: "#3E79F7",
    secondaryAccent: "#87B4FF",
  },
];

type MessageContextMenuState = {
  message: Message;
  x: number;
  y: number;
};

type MediaPayloadFile = {
  media_id: string;
  media_url: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  file_nonce: string;
};

function App() {
  const [session, setSession] = React.useState<Session | null>(() => loadSession());
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [pendingEmail, setPendingEmail] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [themeId, setThemeId] = React.useState<string>(() => loadStoredThemeId());
  const [authBootstrapDone, setAuthBootstrapDone] = React.useState<boolean>(() => loadSession() !== null);
  const activeTheme = React.useMemo(() => SITE_THEMES.find((theme) => theme.id === themeId) ?? SITE_THEMES[0], [themeId]);

  React.useEffect(() => {
    applyTheme(activeTheme);
    localStorage.setItem(THEME_STORAGE_KEY, activeTheme.id);
  }, [activeTheme]);

  async function handleAuthenticated(token: string, cloudPassword: string) {
    const user = await getMe(token);
    const nextSession = { token, user };
    saveSession(nextSession);
    setSession(nextSession);
    setAuthBootstrapDone(true);
    await createAndRegisterDevice(token, cloudPassword);
  }

  async function createAndRegisterDevice(token: string, cloudPassword: string) {
    const bundle = await createDeviceKeyBundle("Windows Desktop", cloudPassword);
    await registerDevice(token, bundle);
    await fingerprintPublicKey(bundle.publicKey);
  }

  function handleLogout() {
    void logout()
      .catch(() => {
        // Ignore logout transport failures and still close the local shell.
      })
      .finally(() => {
        clearSession();
        setSession(null);
        setAuthBootstrapDone(true);
      });
  }

  React.useEffect(() => {
    if (session) {
      setAuthBootstrapDone(true);
      return;
    }
    let active = true;
    void getMe()
      .then((user) => {
        if (!active) {
          return;
        }
        const nextSession = { token: "", user };
        saveSession(nextSession);
        setSession(nextSession);
      })
      .catch(() => {
        if (active) {
          clearSession();
        }
      })
      .finally(() => {
        if (active) {
          setAuthBootstrapDone(true);
        }
      });
    return () => {
      active = false;
    };
  }, [session]);

  React.useEffect(() => {
    if (!session) {
      return;
    }
    let active = true;
    void getMe(session.token)
      .then((user) => {
        if (!active) {
          return;
        }
        const nextSession = { token: session.token, user };
        saveSession(nextSession);
        setSession(nextSession);
      })
      .catch(() => {
        if (active) {
          handleLogout();
        }
      });
    return () => {
      active = false;
    };
  }, [session?.token]);

  if (!session && !authBootstrapDone) {
    return (
      <AuthShell>
        <p className="form-status">Проверяем сессию...</p>
      </AuthShell>
    );
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
      onSessionUserUpdate={(user) => {
        const nextSession = { ...session, user };
        setSession(nextSession);
        saveSession(nextSession);
      }}
      themeId={activeTheme.id}
      onThemeChange={setThemeId}
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
  onSessionUserUpdate,
  themeId,
  onThemeChange,
}: {
  session: Session;
  onLogout: () => void;
  onSessionUserUpdate: (user: CurrentUser) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}) {
  const [friends, setFriends] = React.useState<UserPublic[]>([]);
  const [section, setSection] = React.useState<DashboardSection>(() => loadStoredDashboardSection());
  const [selectedProfile, setSelectedProfile] = React.useState<UserPublic | CurrentUser | null>(() => loadStoredSelectedProfile());
  const [mountedSections, setMountedSections] = React.useState<DashboardSection[]>(() => [loadStoredDashboardSection()]);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = React.useState(0);
  const [friendRequests, setFriendRequests] = React.useState<FriendRequestResponse[]>([]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const visibleNotifications = React.useMemo(
    () => notifications.filter((item) => item.kind !== "friend_request"),
    [notifications],
  );

  React.useEffect(() => {
    void listFriends(session.token).then((response) => setFriends(response.friends));
  }, [session.token]);

  React.useEffect(() => {
    void refreshNotifications();
    void refreshFriendRequests();
  }, [session.token]);

  React.useEffect(() => {
    let active = true;
    void listChats(session.token)
      .then((response) => {
        if (!active) {
          return;
        }
        writeStoredChats(session.user.id, response.chats);
      })
      .catch(() => {
        // keep dashboard responsive even if prefetch fails
      });
    return () => {
      active = false;
    };
  }, [session.token, session.user.id]);

  React.useEffect(() => {
    let active = true;
    if (session.user.status === "online") {
      return;
    }
    void updateMe(session.token, { status: "online" })
      .then((user) => {
        if (!active) {
          return;
        }
        onSessionUserUpdate(user);
      })
      .catch(() => {
        // keep dashboard usable even if presence update fails
      });
    return () => {
      active = false;
    };
  }, [onSessionUserUpdate, session.token, session.user.status]);

  React.useEffect(() => {
    if (!selectedProfile || "email" in selectedProfile) {
      return;
    }
    const refreshed = friends.find((friend) => friend.id === selectedProfile.id);
    if (refreshed) {
      setSelectedProfile(refreshed);
    }
  }, [friends, selectedProfile]);

  React.useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_SECTION_STORAGE_KEY, section);
    } catch {
      // ignore storage write errors
    }
  }, [section]);

  React.useEffect(() => {
    try {
      if (!selectedProfile || ("email" in selectedProfile && selectedProfile.id === session.user.id)) {
        localStorage.removeItem(SELECTED_PROFILE_STORAGE_KEY);
        return;
      }
      localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, JSON.stringify(selectedProfile));
    } catch {
      // ignore storage write errors
    }
  }, [selectedProfile, session.user.id]);

  React.useEffect(() => {
    setMountedSections((current) => (current.includes(section) ? current : [...current, section]));
  }, [section]);

  const playNotificationSound = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay restrictions until the user interacts with the page.
    });
  }, []);

  React.useEffect(() => {
    const socket = connectRealtime(session.token, (event: RealtimeEvent) => {
      if (event.type === "message.new" && event.message && typeof event.message === "object") {
        const incomingMessage = event.message as Message;
        if (incomingMessage.sender.id !== session.user.id) {
          playNotificationSound();
        }
        return;
      }
      if (event.type !== "notification.new" || !event.notification || typeof event.notification !== "object") {
        return;
      }
      const incoming = event.notification as AppNotification;
      setNotifications((current) => [incoming, ...current.filter((item) => item.id !== incoming.id)].slice(0, 50));
      setUnreadNotifications((current) => current + (incoming.is_read ? 0 : 1));
      playNotificationSound();
      if (incoming.kind === "friend_request") {
        void refreshFriendRequests();
      }
    });
    return () => socket.close();
  }, [playNotificationSound, session.token, session.user.id]);

  React.useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(session.user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL);
    }
    audioRef.current.src = session.user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL;
    audioRef.current.preload = "auto";
    audioRef.current.volume = Math.max(0, Math.min(1, session.user.notification_volume ?? 0.7));
  }, [session.user.notification_sound_url, session.user.notification_volume]);

  function openOwnProfile() {
    setSelectedProfile(null);
    setSection("profile");
  }

  function openFriendProfile(friend: UserPublic) {
    setSelectedProfile(friend);
    setSection("profile");
  }

  async function refreshNotifications() {
    try {
      const response = await listNotifications(session.token);
      setNotifications(response.notifications);
      setUnreadNotifications(response.unread_count);
    } catch {
      // keep the dashboard usable even if notifications fail
    }
  }

  async function refreshFriendRequests() {
    try {
      const response = await listFriendRequests(session.token);
      setFriendRequests(response.incoming);
    } catch {
      // keep the dashboard usable even if friend requests fail
    }
  }

  async function handleOpenNotifications() {
    setNotificationsOpen(true);
    if (unreadNotifications > 0) {
      try {
        await markAllNotificationsRead(session.token);
        setUnreadNotifications(0);
        setNotifications((current) =>
          current.map((item) => ({ ...item, is_read: true, read_at: item.read_at ?? new Date().toISOString() })),
        );
      } catch {
        // keep modal open even if read-all fails
      }
    }
  }

  async function handleAcceptFriendRequest(requestId: string) {
    try {
      await acceptFriendRequest(session.token, requestId);
      await Promise.all([refreshFriendRequests(), refreshNotifications()]);
      const response = await listFriends(session.token);
      setFriends(response.friends);
    } catch {
      // leave the request visible if the action failed
    }
  }

  async function handleDeclineFriendRequest(requestId: string) {
    try {
      await declineFriendRequest(session.token, requestId);
      await Promise.all([refreshFriendRequests(), refreshNotifications()]);
    } catch {
      // leave the request visible if the action failed
    }
  }

  async function handleReadNotification(notificationId: string) {
    try {
      const updated = await markNotificationRead(session.token, notificationId);
      setNotifications((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setUnreadNotifications((current) => Math.max(0, current - 1));
    } catch {
      // ignore individual read failures
    }
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
          <div className="brand nav-profile-brand">
            {session.user.avatar_url ? (
              <img alt={session.user.username} src={session.user.avatar_url} />
            ) : (
              session.user.username.slice(0, 1).toUpperCase()
            )}
          </div>
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
        {mountedSections.includes("profile") ? (
        <div style={{ display: section === "profile" ? "block" : "none" }}>
          <ProfilePanel
            onLogout={onLogout}
            token={session.token}
            profile={selectedProfile && selectedProfile.id !== session.user.id ? selectedProfile : session.user}
            sessionUser={session.user}
            onSessionUserUpdate={onSessionUserUpdate}
          />
        </div>
        ) : null}
        {mountedSections.includes("home") ? (
        <div style={{ display: section === "home" ? "block" : "none" }}>
          <HomePanel token={session.token} />
        </div>
        ) : null}
        {mountedSections.includes("chats") ? (
        <div style={{ display: section === "chats" ? "block" : "none" }}>
          <ChatsPanel token={session.token} me={session.user} friends={friends} />
        </div>
        ) : null}
        {mountedSections.includes("friends") ? (
        <div style={{ display: section === "friends" ? "block" : "none" }}>
          <FriendsPanel token={session.token} onFriendsChanged={setFriends} onOpenProfile={openFriendProfile} />
        </div>
        ) : null}
        {mountedSections.includes("games") ? (
        <div style={{ display: section === "games" ? "block" : "none" }}>
          <GamesPanel friends={friends} />
        </div>
        ) : null}
        {mountedSections.includes("clips") ? (
        <div style={{ display: section === "clips" ? "block" : "none" }}>
          <ClipsPanel friends={friends} />
        </div>
        ) : null}
        {mountedSections.includes("settings") ? (
        <div style={{ display: section === "settings" ? "block" : "none" }}>
          <SettingsPanel
            token={session.token}
            user={session.user}
            onSessionUserUpdate={onSessionUserUpdate}
            themeId={themeId}
            onThemeChange={onThemeChange}
          />
        </div>
        ) : null}
      </section>

      <aside className="friends">
        <button aria-label="Уведомления" className="friends-notifications-dock" onClick={() => void handleOpenNotifications()} type="button">
          <Bell size={18} />
          {unreadNotifications > 0 ? <span className="friends-notifications-badge">{unreadNotifications}</span> : null}
        </button>
        {friends.map((friend) => (
          <button className="friend" key={friend.id} onClick={() => openFriendProfile(friend)} type="button">
            <div>
              {friend.avatar_url ? <img alt={friend.username} src={friend.avatar_url} /> : friend.username.slice(0, 1).toUpperCase()}
            </div>
            <span>{friend.username}</span>
          </button>
        ))}
      </aside>

      {notificationsOpen ? (
        <div className="create-chat-modal-overlay" onClick={() => setNotificationsOpen(false)}>
          <div className="create-chat-modal notifications-modal holo-modal" onClick={(event) => event.stopPropagation()}>
            <div className="create-chat-modal-header">
              <h3>Уведомления</h3>
              <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setNotificationsOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <div className="notifications-modal-list">
              {friendRequests.map((request) => (
                <article className="notification-card actionable" key={`request-${request.id}`}>
                  <div className="notification-card-head">
                    <strong>Заявка в друзья</strong>
                    <time>{formatChatListTime(request.created_at)}</time>
                  </div>
                  <p>@{request.from_user.username} хочет добавить вас в друзья.</p>
                  <div className="notification-card-actions">
                    <button onClick={() => void handleAcceptFriendRequest(request.id)} type="button">
                      Принять
                    </button>
                    <button className="secondary" onClick={() => void handleDeclineFriendRequest(request.id)} type="button">
                      Отклонить
                    </button>
                  </div>
                </article>
              ))}

              {visibleNotifications.map((notification) => (
                <article className={`notification-card ${notification.is_read ? "read" : "unread"}`} key={notification.id}>
                  <div className="notification-card-head">
                    <strong>{notification.title}</strong>
                    <time>{formatChatListTime(notification.created_at)}</time>
                  </div>
                  <p>{notification.body}</p>
                  {!notification.is_read ? (
                    <button className="notification-read-button" onClick={() => void handleReadNotification(notification.id)} type="button">
                      Отметить как прочитанное
                    </button>
                  ) : null}
                </article>
              ))}

              {friendRequests.length === 0 && visibleNotifications.length === 0 ? (
                <div className="friends-notification-empty">
                  <Bell size={20} />
                  <p>Пока уведомлений нет.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProfilePanel({
  onLogout,
  token,
  profile,
  sessionUser,
  onSessionUserUpdate,
}: {
  onLogout: () => void;
  token: string;
  profile: UserPublic | CurrentUser;
  sessionUser: CurrentUser;
  onSessionUserUpdate: (user: CurrentUser) => void;
}) {
  const game = profile.current_game ?? "Не играет";
  const status = profile.status || "offline";
  const isOwnProfile = "email" in profile && profile.id === sessionUser.id;
  const [displayName, setDisplayName] = React.useState(sessionUser.display_name ?? "");
  const [username, setUsername] = React.useState(sessionUser.username);
  const [avatarUrl, setAvatarUrl] = React.useState(sessionUser.avatar_url ?? "");
  const [bannerUrl, setBannerUrl] = React.useState(sessionUser.profile_banner_url ?? "");
  const [backgroundUrl, setBackgroundUrl] = React.useState(sessionUser.profile_background_url ?? "");
  const [ringStyle, setRingStyle] = React.useState(sessionUser.avatar_ring_style ?? "holo");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [editingPublicationIndex, setEditingPublicationIndex] = React.useState<number | null>(null);
  const [openedPublication, setOpenedPublication] = React.useState<ProfilePhoto | null>(null);
  const [publishImageUrl, setPublishImageUrl] = React.useState("");
  const [publishCaption, setPublishCaption] = React.useState("");
  const [statusText, setStatusText] = React.useState("");
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const bannerInputRef = React.useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const publishInputRef = React.useRef<HTMLInputElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOwnProfile) {
      return;
    }
    setDisplayName(sessionUser.display_name ?? "");
    setUsername(sessionUser.username);
    setAvatarUrl(sessionUser.avatar_url ?? "");
    setBannerUrl(sessionUser.profile_banner_url ?? "");
    setBackgroundUrl(sessionUser.profile_background_url ?? "");
    setRingStyle(sessionUser.avatar_ring_style ?? "holo");
  }, [
    isOwnProfile,
    sessionUser.avatar_ring_style,
    sessionUser.avatar_url,
    sessionUser.display_name,
    sessionUser.profile_background_url,
    sessionUser.profile_banner_url,
    sessionUser.username,
  ]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }
      const targetNode = event.target as Node;
      if (!menuRef.current.contains(targetNode)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const publicProfilePhotos = React.useMemo(() => parseProfilePhotosFromPublic(profile), [profile]);
  const ownProfilePhotos = React.useMemo(() => parseProfilePhotosFromPublic(sessionUser), [sessionUser]);
  const profilePhotos = isOwnProfile ? ownProfilePhotos : publicProfilePhotos;
  const cardAvatar = isOwnProfile ? avatarUrl || sessionUser.avatar_url : profile.avatar_url;
  const cardBanner = isOwnProfile ? bannerUrl || sessionUser.profile_banner_url : profile.profile_banner_url;
  const cardBackground = isOwnProfile ? backgroundUrl || sessionUser.profile_background_url : profile.profile_background_url;
  const cardName = isOwnProfile
    ? displayName || sessionUser.display_name || sessionUser.username
    : profile.display_name || profile.username;
  const cardUsername = isOwnProfile ? username || sessionUser.username : profile.username;
  const cardStatus = isOwnProfile
    ? sessionUser.profile_status || humanizeStatus(status)
    : profile.profile_status || humanizeStatus(status);
  const cardRing = isOwnProfile ? ringStyle || "holo" : profile.avatar_ring_style || "holo";

  async function handleSingleImagePick(
    file: File | null,
    setter: React.Dispatch<React.SetStateAction<string>>,
    errorText: string,
  ) {
    if (!file) {
      setter("");
      return;
    }
    try {
      setter(await fileToDataUrl(file));
    } catch {
      setStatusText(errorText);
    }
  }

  async function handlePublishImage(file: File | null) {
    if (!file) {
      setPublishImageUrl("");
      return;
    }
    try {
      setPublishImageUrl(await fileToDataUrl(file));
    } catch {
      setStatusText("Не удалось загрузить фото публикации");
    }
  }

  async function handleSaveProfileSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwnProfile) {
      return;
    }
    setStatusText("Сохраняем профиль...");
    try {
      const updated = await updateMe(token, {
        display_name: displayName.trim() || null,
        username: username.trim() || sessionUser.username,
        avatar_url: avatarUrl || null,
        profile_banner_url: bannerUrl || null,
        profile_background_url: backgroundUrl || null,
        avatar_ring_style: ringStyle || null,
      });
      onSessionUserUpdate(updated);
      setSettingsOpen(false);
      setStatusText("Настройки профиля обновлены");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось обновить профиль");
    }
  }

  async function handleCreatePublication(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwnProfile) {
      return;
    }
    if (!publishImageUrl) {
      setStatusText("Выбери изображение для публикации");
      return;
    }
    setStatusText("Публикуем...");
    try {
      const nextPublication: ProfilePhoto = {
        url: publishImageUrl,
        caption: publishCaption.trim() || null,
      };
      const nextPhotos: ProfilePhoto[] =
        editingPublicationIndex === null
          ? [nextPublication, ...ownProfilePhotos].slice(0, 30)
          : ownProfilePhotos.map((photo, index) => (index === editingPublicationIndex ? nextPublication : photo));
      const updated = await updateMe(token, {
        profile_photos: nextPhotos,
      });
      onSessionUserUpdate(updated);
      setPublishImageUrl("");
      setPublishCaption("");
      setEditingPublicationIndex(null);
      setPublishOpen(false);
      setStatusText(editingPublicationIndex === null ? "Публикация добавлена" : "Публикация обновлена");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось сохранить публикацию");
    }
  }

  return (
    <section className="tool-band profile-band">
      <div className="profile-panel profile-layout-card">
        {cardBackground ? (
          <div aria-hidden="true" className="profile-background-media">
            <img alt="" className="profile-background-blur" decoding="async" loading="lazy" src={cardBackground} />
            <img alt="" className="profile-background-image" decoding="async" loading="lazy" src={cardBackground} />
          </div>
        ) : null}
        <div className="profile-layout-head">
          <h2>Профиль</h2>
        </div>
        <div className="profile-layout-grid">
          <div className="profile-primary-column">
            <div className="profile-header-card">
              {isOwnProfile ? (
                <div className="profile-menu-wrap" ref={menuRef}>
                  <button className="profile-menu-button" onClick={() => setMenuOpen((open) => !open)} type="button">
                    <MoreHorizontal size={18} />
                  </button>
                  {menuOpen ? (
                    <div className="profile-menu-dropdown">
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setSettingsOpen(true);
                        }}
                        type="button"
                      >
                        Настройки
                      </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setEditingPublicationIndex(null);
                          setPublishImageUrl("");
                          setPublishCaption("");
                          setPublishOpen(true);
                        }}
                        type="button"
                    >
                      Публикация
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                      type="button"
                    >
                      Выйти
                    </button>
                  </div>
                ) : null}
              </div>
              ) : null}
              <div className="profile-banner-strip">
                {cardBanner ? (
                  <>
                    <img alt="" aria-hidden="true" className="profile-banner-blur" decoding="async" loading="lazy" src={cardBanner} />
                    <img alt="Баннер профиля" className="profile-banner-image" decoding="async" loading="eager" src={cardBanner} />
                  </>
                ) : null}
              </div>
              <div className="profile-identity-row">
                <div className={`profile-avatar-ring ring-${cardRing}`}>
                  <div className="profile-avatar-core">
                    {cardAvatar ? <img alt={profile.username} decoding="async" loading="lazy" src={cardAvatar} /> : <span>{profile.username.slice(0, 1).toUpperCase()}</span>}
                  </div>
                </div>
                <div className="profile-main-meta">
                  <strong>{cardName}</strong>
                  <div className="profile-main-badges">
                    <span className="profile-main-tag">@{cardUsername}</span>
                    <span className={`status-pill status-${normalizeStatus(status)}`}>{cardStatus}</span>
                  </div>
                </div>
              </div>
              <div className="profile-info-card">
                <div className="profile-info-list">
                  <p>Текущая игра: {game}</p>
                  {"email" in profile ? <p>Email: {profile.email}</p> : null}
                  {statusText ? <p>{statusText}</p> : null}
                </div>
              </div>
            </div>

            <div className="profile-publications-panel">
            <div className="profile-publications-head">
              <h2>Публикации</h2>
              <span>{profilePhotos.length}</span>
            </div>
            {profilePhotos.length > 0 ? (
              <div className="profile-photo-grid">
                {profilePhotos.map((photo, index) => (
                  <article className="profile-photo-card" key={`${photo.url.slice(0, 24)}-${index}`}>
                    {isOwnProfile ? (
                      <button
                        aria-label="Редактировать публикацию"
                        className="profile-photo-edit"
                        onClick={() => {
                          setEditingPublicationIndex(index);
                          setPublishImageUrl(photo.url);
                          setPublishCaption(photo.caption ?? "");
                          setPublishOpen(true);
                        }}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                    <button className="profile-photo-open" onClick={() => setOpenedPublication(photo)} type="button">
                      <img alt={`Фото ${index + 1}`} src={photo.url} />
                      <p className="form-status">{photo.caption || "Без подписи"}</p>
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="form-status">Публикаций пока нет</p>
            )}
            </div>
          </div>
        </div>
      </div>

      {isOwnProfile && settingsOpen ? (
        <div className="create-chat-modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="create-chat-modal profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="create-chat-modal-header">
              <h3>Настройки профиля</h3>
              <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setSettingsOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <form className="auth-form profile-edit-form" onSubmit={handleSaveProfileSettings}>
              <label>
                Имя
                <input maxLength={120} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
              </label>
              <label>
                Никнейм
                <input maxLength={32} minLength={3} onChange={(event) => setUsername(event.target.value)} value={username} />
              </label>
              <label>
                Стиль обводки аватара
                <select onChange={(event) => setRingStyle(event.target.value)} value={ringStyle}>
                  <option value="holo">Holo</option>
                  <option value="neon">Neon</option>
                  <option value="soft">Soft</option>
                </select>
              </label>
              <div className="create-chat-media">
                <button onClick={() => avatarInputRef.current?.click()} type="button">
                  Аватар
                </button>
                <button onClick={() => bannerInputRef.current?.click()} type="button">
                  Баннер
                </button>
                <button onClick={() => backgroundInputRef.current?.click()} type="button">
                  Фон профиля
                </button>
              </div>
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) => void handleSingleImagePick(event.target.files?.[0] ?? null, setAvatarUrl, "Не удалось загрузить аватар")}
                ref={avatarInputRef}
                type="file"
              />
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) => void handleSingleImagePick(event.target.files?.[0] ?? null, setBannerUrl, "Не удалось загрузить баннер")}
                ref={bannerInputRef}
                type="file"
              />
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) => void handleSingleImagePick(event.target.files?.[0] ?? null, setBackgroundUrl, "Не удалось загрузить фон")}
                ref={backgroundInputRef}
                type="file"
              />
              <button type="submit">Сохранить</button>
            </form>
          </div>
        </div>
      ) : null}

      {isOwnProfile && publishOpen ? (
        <div className="create-chat-modal-overlay" onClick={() => setPublishOpen(false)}>
          <div className="create-chat-modal profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="create-chat-modal-header">
              <h3>{editingPublicationIndex === null ? "Новая публикация" : "Редактирование публикации"}</h3>
              <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setPublishOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <form className="auth-form profile-edit-form" onSubmit={handleCreatePublication}>
              <div className="create-chat-media">
                <button onClick={() => publishInputRef.current?.click()} type="button">
                  Выбрать фото
                </button>
              </div>
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) => void handlePublishImage(event.target.files?.[0] ?? null)}
                ref={publishInputRef}
                type="file"
              />
              {publishImageUrl ? (
                <div className="profile-photo-card">
                  <img alt="Публикация" src={publishImageUrl} />
                </div>
              ) : null}
              <label>
                Подпись
                <input maxLength={240} onChange={(event) => setPublishCaption(event.target.value)} value={publishCaption} />
              </label>
              <button type="submit">{editingPublicationIndex === null ? "Опубликовать" : "Сохранить"}</button>
            </form>
          </div>
        </div>
      ) : null}

      {openedPublication ? (
        <div className="create-chat-modal-overlay" onClick={() => setOpenedPublication(null)}>
          <div className="profile-publication-lightbox" onClick={(event) => event.stopPropagation()}>
            <button
              aria-label="Закрыть публикацию"
              className="create-chat-modal-close profile-lightbox-close"
              onClick={() => setOpenedPublication(null)}
              type="button"
            >
              <X size={16} />
            </button>
            <img alt={openedPublication.caption || "Публикация"} src={openedPublication.url} />
            {openedPublication.caption ? <p>{openedPublication.caption}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function parseProfilePhotosFromPublic(profile: UserPublic | CurrentUser): ProfilePhoto[] {
  if ("email" in profile) {
    const rawOwnPhotos = profile.profile_photos;
    if (!Array.isArray(rawOwnPhotos)) {
      return [];
    }
    return rawOwnPhotos
      .map((item) => {
        if (typeof item === "string") {
          return { url: item, caption: null } as ProfilePhoto;
        }
        if (item && typeof item === "object" && typeof item.url === "string") {
          return { url: item.url, caption: typeof item.caption === "string" ? item.caption : null } as ProfilePhoto;
        }
        return null;
      })
      .filter((item): item is ProfilePhoto => item !== null);
  }
  const raw = profile.profile_photos;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (typeof item === "string") {
          return { url: item, caption: null } as ProfilePhoto;
        }
        if (item && typeof item === "object" && typeof item.url === "string") {
          return { url: item.url, caption: typeof item.caption === "string" ? item.caption : null } as ProfilePhoto;
        }
        return null;
      })
      .filter((item): item is ProfilePhoto => item !== null);
  } catch {
    return [];
  }
}

function HomePanel({ token }: { token: string }) {
  const [items, setItems] = React.useState<FeedPublication[]>([]);
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setStatus("Загружаем публикации...");
    void listFeed(token)
      .then((response) => {
        if (!active) {
          return;
        }
        setItems(response);
        setStatus(response.length === 0 ? "Публикаций пока нет" : "");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setStatus(error instanceof Error ? error.message : "Не удалось загрузить публикации");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <section className="tool-band single-column">
      <div>
        <h2>Главная</h2>
        {status ? <p className="form-status">{status}</p> : null}
        {items.length > 0 ? (
          <div className="home-feed-grid">
            {items.map((item, index) => (
              <article className="home-feed-card" key={`${item.author_id}-${item.image_url.slice(0, 24)}-${index}`}>
                <img alt={item.caption || "Публикация"} className="home-feed-image" decoding="async" loading="lazy" src={item.image_url} />
                <div className="home-feed-meta">
                  <div className="home-feed-author">
                    <div className="home-feed-avatar">
                      {item.author_avatar_url ? <img alt={item.author_username} decoding="async" loading="lazy" src={item.author_avatar_url} /> : item.author_username.slice(0, 1).toUpperCase()}
                    </div>
                    <strong>@{item.author_username}</strong>
                  </div>
                  <p>{item.caption || "Без подписи"}</p>
                </div>
              </article>
            ))}
          </div>
        ) : null}
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
  token,
  user,
  onSessionUserUpdate,
  themeId,
  onThemeChange,
}: {
  token: string;
  user: CurrentUser;
  onSessionUserUpdate: (user: CurrentUser) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}) {
  const [autoStart, setAutoStart] = React.useState(false);
  const [notifEnabled, setNotifEnabled] = React.useState(true);
  const [themesOpen, setThemesOpen] = React.useState(false);
  const [notificationSoundUrl, setNotificationSoundUrl] = React.useState(user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL);
  const [notificationVolume, setNotificationVolume] = React.useState(Math.round((user.notification_volume ?? 0.7) * 100));
  const [settingsStatus, setSettingsStatus] = React.useState("");

  React.useEffect(() => {
    setNotificationSoundUrl(user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL);
    setNotificationVolume(Math.round((user.notification_volume ?? 0.7) * 100));
  }, [user.notification_sound_url, user.notification_volume]);

  async function handleSaveNotificationSettings() {
    setSettingsStatus("Сохраняем настройки уведомлений...");
    try {
      const updated = await updateMe(token, {
        notification_sound_url: notificationSoundUrl,
        notification_volume: notificationVolume / 100,
      });
      onSessionUserUpdate(updated);
      setSettingsStatus("Настройки уведомлений сохранены");
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : "Не удалось сохранить настройки уведомлений");
    }
  }

  return (
    <section className="tool-band single-column settings-panel">
      <div className="settings-main-card">
        <div className="panel-hero panel-hero-settings">
          <span>Settings center</span>
          <h2>Настройки</h2>
          <p>Управляй темой, уведомлениями и поведением клиента из одной аккуратной панели.</p>
        </div>

        <div className="settings-section-grid">
          <section className="settings-panel-card">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Palette size={18} />
              </div>
              <div>
                <h3>Темы</h3>
                <p>Открой список палитр и выбери тему для всего интерфейса.</p>
              </div>
            </div>
            <button className="settings-theme-trigger" onClick={() => setThemesOpen(true)} type="button">
              <Palette size={18} />
              <span>Открыть темы</span>
            </button>
          </section>

          <section className="settings-panel-card">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Bell size={18} />
              </div>
              <div>
                <h3>Поведение клиента</h3>
                <p>Быстрые переключатели для ежедневной работы.</p>
              </div>
            </div>
            <div className="settings-toggle-list">
              <label className="settings-toggle-row">
                <div>
                  <strong>Запуск вместе с Windows</strong>
                  <span>Открывать приложение сразу после входа в систему.</span>
                </div>
                <input checked={autoStart} onChange={() => setAutoStart((value) => !value)} type="checkbox" />
              </label>
              <label className="settings-toggle-row">
                <div>
                  <strong>Уведомления</strong>
                  <span>Показывать новые сообщения и события в системе.</span>
                </div>
                <input checked={notifEnabled} onChange={() => setNotifEnabled((value) => !value)} type="checkbox" />
              </label>
              <label className="settings-toggle-row settings-input-row">
                <div>
                  <strong>Звук уведомления</strong>
                  <span>URL звука, который будет проигрываться при новом уведомлении.</span>
                </div>
                <input onChange={(event) => setNotificationSoundUrl(event.target.value)} value={notificationSoundUrl} />
              </label>
              <label className="settings-toggle-row settings-input-row">
                <div>
                  <strong>Громкость</strong>
                  <span>{notificationVolume}%</span>
                </div>
                <input
                  max={100}
                  min={0}
                  onChange={(event) => setNotificationVolume(Number(event.target.value))}
                  type="range"
                  value={notificationVolume}
                />
              </label>
            </div>
            <button className="settings-save-button" onClick={() => void handleSaveNotificationSettings()} type="button">
              Сохранить уведомления
            </button>
            <p className={`form-status settings-status ${settingsStatus ? "visible" : ""}`}>{settingsStatus || " "}</p>
          </section>
        </div>
      </div>

      {themesOpen ? (
        <div className="create-chat-modal-overlay" onClick={() => setThemesOpen(false)}>
          <div className="create-chat-modal settings-themes-modal" onClick={(event) => event.stopPropagation()}>
            <div className="create-chat-modal-header">
              <h3>Темы</h3>
              <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setThemesOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <div className="theme-grid settings-theme-grid">
              {SITE_THEMES.map((theme) => (
                <button
                  className={`theme-card ${themeId === theme.id ? "active" : ""}`}
                  key={theme.id}
                  onClick={() => {
                    onThemeChange(theme.id);
                    setThemesOpen(false);
                  }}
                  type="button"
                >
                  <div className="theme-card-swatches">
                    <span style={{ backgroundColor: theme.background }} />
                    <span style={{ backgroundColor: theme.surface }} />
                    <span style={{ backgroundColor: theme.text }} />
                    <span style={{ backgroundColor: theme.accent }} />
                    <span style={{ backgroundColor: theme.secondaryAccent }} />
                  </div>
                  <strong>{theme.name}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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
  const onlineFriends = React.useMemo(
    () => friends.filter((friend) => normalizeStatus(friend.status) === "online").length,
    [friends],
  );
  const pendingResults = React.useMemo(
    () => searchResults.filter((user) => !friends.some((friend) => friend.id === user.id)),
    [friends, searchResults],
  );

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
    <section className="tool-band friends-panel">
      <div className="friends-main-card">
        <div className="panel-hero panel-hero-friends">
          <span>Friends hub</span>
          <h2>Друзья</h2>
          <p>Быстрый поиск, карточки профилей и invite-код в одном пространстве без перегруза.</p>
          <div className="friends-stats">
            <div className="friends-stat">
              <strong>{friends.length}</strong>
              <span>всего друзей</span>
            </div>
            <div className="friends-stat">
              <strong>{onlineFriends}</strong>
              <span>сейчас онлайн</span>
            </div>
            <div className="friends-stat">
              <strong>{inviteCode ? "готов" : "..."}</strong>
              <span>invite-код</span>
            </div>
          </div>
        </div>

        <form className="inline-form friends-search-form" onSubmit={handleSearch}>
          <div className="friends-search-input">
            <Search size={16} />
            <input placeholder="Найти по username" value={query} onChange={(event) => setQuery(event.target.value)} required />
          </div>
          <button type="submit">Найти</button>
        </form>

        <div className="friends-grid">
          {friends.map((friend) => (
            <article className="friend-card" key={friend.id}>
              <div className="friend-card-head">
                <div className="friend-card-avatar">
                  {friend.avatar_url ? <img alt={friend.username} src={friend.avatar_url} /> : friend.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="friend-card-meta">
                  <strong>{friend.display_name || friend.username}</strong>
                  <span>@{friend.username}</span>
                </div>
                <small className={`status-pill status-${normalizeStatus(friend.status)}`}>{humanizeStatus(friend.status)}</small>
              </div>
              <p className="friend-card-game">{friend.current_game ?? "Сейчас не играет"}</p>
              <button onClick={() => onOpenProfile(friend)} type="button">
                Профиль
              </button>
            </article>
          ))}
          {friends.length === 0 ? <div className="friends-empty-state">Пока нет друзей. Найди пользователя или пригласи по коду.</div> : null}
        </div>
      </div>

      <div className="friends-side-column">
        <section className="friends-panel-card">
          <div className="friends-card-head">
            <div className="friends-card-icon">
              <UserPlus size={18} />
            </div>
            <div>
              <h3>Добавить друга</h3>
              <p>Результаты поиска и отправка заявки.</p>
            </div>
          </div>
          <div className="friends-result-list">
            {pendingResults.map((user) => (
              <div className="friends-result-row" key={user.id}>
                <div>
                  <strong>{user.display_name || user.username}</strong>
                  <span>@{user.username}</span>
                </div>
                <button onClick={() => handleRequest(user.username)} type="button">
                  Заявка
                </button>
              </div>
            ))}
            {query && pendingResults.length === 0 ? <p className="form-status">После поиска здесь появятся новые пользователи.</p> : null}
          </div>
        </section>

        <section className="friends-panel-card friends-invite-card">
          <div className="friends-card-head">
            <div className="friends-card-icon">
              <Copy size={18} />
            </div>
            <div>
              <h3>Invite-код</h3>
              <p>Создай код и поделись им, чтобы добавить друга быстрее.</p>
            </div>
          </div>
          <div className="invite-code-box">{inviteCode || "Код еще не создан"}</div>
          <div className="friends-action-row">
            <button className="inline-action" onClick={handleCreateInvite} type="button">
              Создать код
            </button>
            <button className="inline-action secondary" onClick={handleCopyInviteCode} type="button">
              Скопировать
            </button>
          </div>
          <form className="inline-form stacked" onSubmit={handleAddByCode}>
            <input placeholder="Вставь код друга" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} required />
            <button type="submit">Добавить по коду</button>
          </form>
        </section>

        <p className={`form-status friends-status ${status ? "visible" : ""}`}>{status || " "}</p>
      </div>
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
  const [chats, setChats] = React.useState<Chat[]>(() => readStoredChats(me.id));
  const [selectedChatId, setSelectedChatId] = React.useState<string>(() => readStoredSelectedChatId(me.id));
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [messageText, setMessageText] = React.useState("");
  const [attachmentFiles, setAttachmentFiles] = React.useState<File[]>([]);
  const [composerDragActive, setComposerDragActive] = React.useState(false);
  const [decodeMap, setDecodeMap] = React.useState<Record<string, string>>({});
  const [createChatOpen, setCreateChatOpen] = React.useState(false);
  const [createChatTitle, setCreateChatTitle] = React.useState("");
  const [chatParticipants, setChatParticipants] = React.useState<string[]>([]);
  const [chatAvatarDataUrl, setChatAvatarDataUrl] = React.useState("");
  const [chatBackgroundDataUrl, setChatBackgroundDataUrl] = React.useState("");
  const [memberUsername, setMemberUsername] = React.useState("");
  const [createParticipantsDropdownOpen, setCreateParticipantsDropdownOpen] = React.useState(false);
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = React.useState(false);
  const [chatInfoModalOpen, setChatInfoModalOpen] = React.useState(false);
  const [editChatTitle, setEditChatTitle] = React.useState("");
  const [editChatAvatarDataUrl, setEditChatAvatarDataUrl] = React.useState("");
  const [editChatBackgroundDataUrl, setEditChatBackgroundDataUrl] = React.useState("");
  const [contextMenu, setContextMenu] = React.useState<MessageContextMenuState | null>(null);
  const [previewMediaUrl, setPreviewMediaUrl] = React.useState<string | null>(null);
  const [previewMediaType, setPreviewMediaType] = React.useState<string>("");
  const [pinnedChatIds, setPinnedChatIds] = React.useState<string[]>(() => readStoredStringList(PINNED_CHATS_STORAGE_KEY));
  const [hiddenChatIds, setHiddenChatIds] = React.useState<string[]>(() => readStoredStringList(HIDDEN_CHATS_STORAGE_KEY));
  const [status, setStatus] = React.useState("");
  const [isSendingMessage, setIsSendingMessage] = React.useState(false);
  const [chatsLoading, setChatsLoading] = React.useState<boolean>(() => readStoredChats(me.id).length === 0);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 820px)").matches;
  });
  const [mobileChatOpen, setMobileChatOpen] = React.useState(false);

  const createParticipantsDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const editAvatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const editBackgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const selectedChatIdRef = React.useRef<string>("");
  const messageRequestRef = React.useRef(0);
  const decodedMessagesCacheRef = React.useRef<Record<string, Record<string, string>>>({});
  const chatMessagesCacheRef = React.useRef<Record<string, Message[]>>({});

  const pinnedChatSet = React.useMemo(() => new Set(pinnedChatIds), [pinnedChatIds]);
  const visibleChats = React.useMemo(() => chats.filter((chat) => !hiddenChatIds.includes(chat.id)), [chats, hiddenChatIds]);
  const orderedChats = React.useMemo(() => {
    return [...visibleChats].sort((left, right) => {
      const leftPinned = pinnedChatSet.has(left.id) ? 1 : 0;
      const rightPinned = pinnedChatSet.has(right.id) ? 1 : 0;
      if (leftPinned !== rightPinned) {
        return rightPinned - leftPinned;
      }
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  }, [visibleChats, pinnedChatSet]);
  const pinnedChats = React.useMemo(() => orderedChats.filter((chat) => pinnedChatSet.has(chat.id)), [orderedChats, pinnedChatSet]);
  const regularChats = React.useMemo(() => orderedChats.filter((chat) => !pinnedChatSet.has(chat.id)), [orderedChats, pinnedChatSet]);

  const selectedChat = orderedChats.find((chat) => chat.id === selectedChatId) ?? null;
  const selectedChatMeta = selectedChat ? getChatPresentation(selectedChat, me) : null;
  const myMember = selectedChat?.members.find((member) => member.user.id === me.id) ?? null;
  const canManageMembers = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const canManageRoles = selectedChat?.type === "group" && myMember?.role === "owner";
  const canModerateAllMessages = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const currentUserPublic = React.useMemo<UserPublic>(
    () => ({
      id: me.id,
      username: me.username,
      display_name: me.display_name,
      nickname: me.nickname,
      profile_status: me.profile_status,
      profile_banner_url: me.profile_banner_url,
      profile_background_url: me.profile_background_url,
      profile_photos: JSON.stringify(me.profile_photos ?? []),
      avatar_ring_style: me.avatar_ring_style,
      avatar_url: me.avatar_url,
      status: me.status,
      current_game: me.current_game,
    }),
    [me],
  );
  const chatPaneStyle: React.CSSProperties | undefined = selectedChat?.background_url
    ? {
        backgroundImage: `url("${selectedChat.background_url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }
    : undefined;

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
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const updateMatch = () => setIsMobile(mediaQuery.matches);
    updateMatch();
    mediaQuery.addEventListener("change", updateMatch);
    return () => mediaQuery.removeEventListener("change", updateMatch);
  }, []);

  React.useEffect(() => {
    if (!isMobile) {
      setMobileChatOpen(false);
    }
  }, [isMobile]);

  React.useEffect(() => {
    if (!isMobile || !mobileChatOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, mobileChatOpen]);

  React.useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  React.useEffect(() => {
    if (orderedChats.length === 0) {
      if (selectedChatId) {
        setSelectedChatId("");
      }
      if (isMobile) {
        setMobileChatOpen(false);
      }
      return;
    }
    if (orderedChats.some((chat) => chat.id === selectedChatId)) {
      return;
    }
    if (isMobile) {
      setMobileChatOpen(false);
      return;
    }
    setSelectedChatId(orderedChats[0].id);
  }, [isMobile, orderedChats, selectedChatId]);

  React.useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      setDecodeMap({});
      setMessagesLoading(false);
      return;
    }
    void loadChatMessages(selectedChatId);
  }, [selectedChatId, token]);

  React.useEffect(() => {
    const socket = connectRealtime(token, (event: RealtimeEvent) => {
      if (event.type === "message.new") {
        const incoming = event.message as Message;
        bumpChatActivity(incoming.chat_id, incoming.created_at);
        const cachedMessages = chatMessagesCacheRef.current[incoming.chat_id];
        if (cachedMessages && !cachedMessages.some((item) => item.id === incoming.id)) {
          chatMessagesCacheRef.current[incoming.chat_id] = [...cachedMessages, incoming];
        }
        void decodeMessagesForChat(incoming.chat_id, [incoming]).then((decoded) => {
          if (incoming.chat_id === selectedChatIdRef.current) {
            setDecodeMap(decoded);
          }
        });
        if (incoming.chat_id === selectedChatIdRef.current) {
          void markChatAsRead(incoming.chat_id);
          setMessages((previous) => {
            if (previous.some((item) => item.id === incoming.id)) {
              return previous;
            }
            const next = [...previous, incoming];
            chatMessagesCacheRef.current[incoming.chat_id] = next;
            return next;
          });
          setChats((previous) => previous.map((chat) => (chat.id === incoming.chat_id ? { ...chat, unread_count: 0 } : chat)));
        } else if (incoming.sender.id !== me.id) {
          setChats((previous) =>
            previous.map((chat) =>
              chat.id === incoming.chat_id ? { ...chat, unread_count: (chat.unread_count ?? 0) + 1, updated_at: incoming.created_at } : chat,
            ),
          );
        }
        return;
      }

      if (event.type === "message.updated") {
        const incoming = event.message as Message;
        const cachedMessages = chatMessagesCacheRef.current[incoming.chat_id];
        if (cachedMessages) {
          chatMessagesCacheRef.current[incoming.chat_id] = cachedMessages.map((item) => (item.id === incoming.id ? incoming : item));
        }
        void decodeMessagesForChat(incoming.chat_id, [incoming]).then((decoded) => {
          if (incoming.chat_id === selectedChatIdRef.current) {
            setDecodeMap(decoded);
          }
        });
        if (incoming.chat_id === selectedChatIdRef.current) {
          setMessages((previous) => {
            const next = previous.map((item) => (item.id === incoming.id ? incoming : item));
            chatMessagesCacheRef.current[incoming.chat_id] = next;
            return next;
          });
        }
        return;
      }

      if (event.type === "message.deleted") {
        const deletedChatId = typeof event.chat_id === "string" ? event.chat_id : "";
        const deletedId = typeof event.message_id === "string" ? event.message_id : "";
        if (deletedChatId && deletedId && chatMessagesCacheRef.current[deletedChatId]) {
          chatMessagesCacheRef.current[deletedChatId] = chatMessagesCacheRef.current[deletedChatId].filter((item) => item.id !== deletedId);
        }
        if (deletedChatId && deletedId && decodedMessagesCacheRef.current[deletedChatId]) {
          delete decodedMessagesCacheRef.current[deletedChatId][deletedId];
        }
        if (deletedChatId === selectedChatIdRef.current) {
          if (deletedId) {
            setMessages((previous) => {
              const next = previous.filter((item) => item.id !== deletedId);
              chatMessagesCacheRef.current[deletedChatId] = next;
              return next;
            });
            setDecodeMap((previous) => {
              const next = { ...previous };
              delete next[deletedId];
              return next;
            });
          }
        }
        return;
      }
    });
    return () => socket.close();
  }, [token]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const targetNode = event.target as Node;
      if (createParticipantsDropdownRef.current && !createParticipantsDropdownRef.current.contains(targetNode)) {
        setCreateParticipantsDropdownOpen(false);
      }
      setContextMenu(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (!selectedChat) {
      setChatInfoModalOpen(false);
      setChatSettingsModalOpen(false);
      return;
    }
    setEditChatTitle(selectedChat.title ?? "");
    setEditChatAvatarDataUrl(selectedChat.avatar_url ?? "");
    setEditChatBackgroundDataUrl(selectedChat.background_url ?? "");
    if (selectedChat.type !== "group") {
      setChatSettingsModalOpen(false);
    }
  }, [selectedChat?.id, selectedChat?.type, selectedChat?.title, selectedChat?.avatar_url, selectedChat?.background_url]);

  React.useEffect(() => {
    writeStoredStringList(PINNED_CHATS_STORAGE_KEY, pinnedChatIds);
  }, [pinnedChatIds]);

  React.useEffect(() => {
    writeStoredStringList(HIDDEN_CHATS_STORAGE_KEY, hiddenChatIds);
  }, [hiddenChatIds]);

  React.useEffect(() => {
    writeStoredChats(me.id, chats);
  }, [chats, me.id]);

  React.useEffect(() => {
    writeStoredSelectedChatId(me.id, selectedChatId);
  }, [me.id, selectedChatId]);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages.length, selectedChatId, scrollToBottom]);

  React.useEffect(() => {
    const chatsToPrefetch = orderedChats.slice(0, 8).map((chat) => chat.id);
    const schedulePrefetch = () => {
      for (const chatId of chatsToPrefetch) {
        if (!chatMessagesCacheRef.current[chatId]) {
          void prefetchChatMessages(chatId);
        }
      }
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(schedulePrefetch, { timeout: 1200 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = setTimeout(schedulePrefetch, 120);
    return () => clearTimeout(timeoutId);
  }, [orderedChats]);

  async function reloadChats() {
    setChatsLoading(true);
    try {
      const response = await listChats(token);
      setChats(response.chats);
      const hotChat = [...response.chats].sort(
        (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      )[0];
      if (hotChat && !chatMessagesCacheRef.current[hotChat.id]) {
        void prefetchChatMessages(hotChat.id);
      }
    } finally {
      setChatsLoading(false);
    }
  }

  function bumpChatActivity(chatId: string, updatedAt: string) {
    setChats((previous) =>
      previous.map((chat) => (chat.id === chatId ? { ...chat, updated_at: updatedAt } : chat)),
    );
  }

  async function markChatAsRead(chatId: string) {
    try {
      await markChatRead(token, chatId);
    } catch {
      // keep UI responsive if mark-read fails
    }
    setChats((previous) => previous.map((chat) => (chat.id === chatId ? { ...chat, unread_count: 0 } : chat)));
  }

  async function decodeMessagesForChat(chatId: string, items: Message[]): Promise<Record<string, string>> {
    const existing = decodedMessagesCacheRef.current[chatId] ?? {};
    const nextDecoded: Record<string, string> = { ...existing };
    const pendingItems = items.filter((message) => nextDecoded[message.id] === undefined);
    if (pendingItems.length > 0) {
      const key = await ensureChatKey(chatId);
      const resolvedEntries = await Promise.all(
        pendingItems.map(async (message) => {
          try {
            const plain = await decryptTextWithSharedKey({ ciphertext: message.ciphertext, nonce: message.nonce }, key);
            return [message.id, plain] as const;
          } catch {
            return [message.id, "Не удалось расшифровать сообщение"] as const;
          }
        }),
      );
      for (const [messageId, value] of resolvedEntries) {
        nextDecoded[messageId] = value;
      }
    }
    decodedMessagesCacheRef.current[chatId] = nextDecoded;
    return nextDecoded;
  }

  async function loadChatMessages(chatId: string) {
    const requestId = messageRequestRef.current + 1;
    messageRequestRef.current = requestId;

    const cachedMessages = chatMessagesCacheRef.current[chatId];
    const cachedDecoded = decodedMessagesCacheRef.current[chatId];
    if (cachedMessages) {
      setMessages(cachedMessages);
      setDecodeMap(cachedDecoded ?? {});
    } else {
      setMessages([]);
      setDecodeMap({});
      setMessagesLoading(true);
    }

    try {
      const fetchedMessages = await listChatMessages(token, chatId);
      const decoded = await decodeMessagesForChat(chatId, fetchedMessages);
      if (messageRequestRef.current !== requestId || selectedChatIdRef.current !== chatId) {
        return;
      }
      chatMessagesCacheRef.current[chatId] = fetchedMessages;
      setMessages(fetchedMessages);
      setDecodeMap(decoded);
      await markChatAsRead(chatId);
    } finally {
      if (messageRequestRef.current === requestId && selectedChatIdRef.current === chatId) {
        setMessagesLoading(false);
      }
    }
  }

  async function prefetchChatMessages(chatId: string) {
    if (chatMessagesCacheRef.current[chatId]) {
      return;
    }
    try {
      const fetchedMessages = await listChatMessages(token, chatId);
      chatMessagesCacheRef.current[chatId] = fetchedMessages;
      await decodeMessagesForChat(chatId, fetchedMessages);
    } catch {
      // keep prefetch silent
    }
  }

  function toggleParticipant(username: string) {
    setChatParticipants((current) => {
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

  async function handleCreateChat(event: React.FormEvent) {
    event.preventDefault();
    const usernames = Array.from(new Set(chatParticipants.map((item) => item.trim()).filter((item) => item.length > 0)));
    if (usernames.length === 0) {
      setStatus("Выбери хотя бы одного участника");
      return;
    }

    const title = createChatTitle.trim();
    const hasCustomMedia = Boolean(chatAvatarDataUrl || chatBackgroundDataUrl);
    const isDirectCreate = usernames.length === 1 && !title && !hasCustomMedia;

    if (!isDirectCreate && !title) {
      setStatus("Укажи название группы");
      return;
    }

    setStatus(isDirectCreate ? "Создаем чат..." : "Создаем групповой чат...");
    try {
      const chat = isDirectCreate
        ? await createDirectChat(token, usernames[0])
        : await createGroupChat(token, {
            title,
            usernames,
            avatar_url: chatAvatarDataUrl || undefined,
            background_url: chatBackgroundDataUrl || undefined,
          });

      setHiddenChatIds((current) => current.filter((item) => item !== chat.id));

      setCreateChatTitle("");
      setChatParticipants([]);
      setChatAvatarDataUrl("");
      setChatBackgroundDataUrl("");
      setCreateParticipantsDropdownOpen(false);
      setCreateChatOpen(false);
      await ensureChatKey(chat.id);
      await reloadChats();
      setSelectedChatId(chat.id);
      setStatus(isDirectCreate ? "Чат создан" : "Групповой чат готов");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать чат");
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

  async function sendEncryptedText(text: string): Promise<Message> {
    if (!selectedChatId) {
      throw new Error("Чат не выбран");
    }
    const key = await ensureChatKey(selectedChatId);
    const encrypted = await encryptTextForSharedKey(text, key);
    return sendChatMessage(token, selectedChatId, {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      message_type: "text",
    });
  }

  async function uploadEncryptedAttachment(file: File): Promise<MediaPayloadFile> {
    if (!selectedChatId) {
      throw new Error("Чат не выбран");
    }
    const chatKey = await ensureChatKey(selectedChatId);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const encryptedFile = await encryptBytesForSharedKey(fileBytes, chatKey);
    const encryptedBuffer = new ArrayBuffer(encryptedFile.ciphertextBytes.byteLength);
    new Uint8Array(encryptedBuffer).set(encryptedFile.ciphertextBytes);
    const encryptedBlob = new Blob([encryptedBuffer], { type: "application/octet-stream" });
    const encryptedFileObject = new File([encryptedBlob], `${file.name}.enc`, { type: "application/octet-stream" });
    const media = await uploadEncryptedMedia(token, selectedChatId, encryptedFileObject);
    const encryptedPayload = await encryptTextForSharedKey(
      JSON.stringify({
        kind: "media",
        media_id: media.media_id,
        media_url: media.media_url,
        file_name: file.name,
        file_size: file.size,
        file_mime: file.type || "application/octet-stream",
        file_nonce: encryptedFile.nonce,
      }),
      chatKey,
    );
    return {
      media_id: media.media_id,
      media_url: media.media_url,
      file_name: file.name,
      file_size: file.size,
      file_mime: file.type || "application/octet-stream",
      file_nonce: encryptedFile.nonce,
    };
  }

  async function handleSendComposer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }

    const text = messageText.trim();
    if (!text && attachmentFiles.length === 0) {
      setStatus("Введите сообщение или прикрепите файл");
      return;
    }

    const activeChatId = selectedChatId;
    setIsSendingMessage(true);
    try {
      if (text) {
        const optimisticId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticMessage: Message = {
          id: optimisticId,
          chat_id: activeChatId,
          sender: currentUserPublic,
          ciphertext: "",
          nonce: "",
          message_type: "text",
          expires_at: "",
          created_at: new Date().toISOString(),
        };
        setMessages((previous) => {
          const next = [...previous, optimisticMessage];
          chatMessagesCacheRef.current[activeChatId] = next;
          return next;
        });
        setDecodeMap((previous) => {
          const next = { ...previous, [optimisticId]: text };
          decodedMessagesCacheRef.current[activeChatId] = next;
          return next;
        });
        bumpChatActivity(activeChatId, optimisticMessage.created_at);
        setMessageText("");
        const sentMessage = await sendEncryptedText(text);
        setMessages((previous) => {
          const next = dedupeMessagesById(previous.map((item) => (item.id === optimisticId ? sentMessage : item)));
          chatMessagesCacheRef.current[activeChatId] = next;
          return next;
        });
        setDecodeMap((previous) => {
          const next = { ...previous, [sentMessage.id]: text };
          delete next[optimisticId];
          decodedMessagesCacheRef.current[activeChatId] = next;
          return next;
        });
        bumpChatActivity(activeChatId, sentMessage.created_at);
      }
      if (attachmentFiles.length > 0) {
        const batches = chunkArray(attachmentFiles, 10);
        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          setStatus(`Шифруем и отправляем вложения ${index + 1}/${batches.length}...`);
          const uploadedFiles = await Promise.all(batch.map((file) => uploadEncryptedAttachment(file)));
          const chatKey = await ensureChatKey(selectedChatId);
          const encryptedPayload = await encryptTextForSharedKey(
            JSON.stringify({
              kind: "media_batch",
              files: uploadedFiles,
            }),
            chatKey,
          );
          const sentBatchMessage = await sendChatMessage(token, selectedChatId, {
            ciphertext: encryptedPayload.ciphertext,
            nonce: encryptedPayload.nonce,
            message_type: "media",
          });
          bumpChatActivity(selectedChatId, sentBatchMessage.created_at);
        }
      }
      setAttachmentFiles([]);
      setStatus("");
    } catch (error) {
      if (text) {
        setMessages((previous) => previous.filter((item) => !item.id.startsWith("local-")));
        setDecodeMap((previous) => {
          const next = { ...previous };
          for (const messageId of Object.keys(next)) {
            if (messageId.startsWith("local-")) {
              delete next[messageId];
            }
          }
          decodedMessagesCacheRef.current[activeChatId] = next;
          return next;
        });
        setMessageText(text);
      }
      setStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    } finally {
      setIsSendingMessage(false);
    }
  }

  function addFilesToComposer(files: File[]) {
    if (files.length === 0) {
      return;
    }
    setAttachmentFiles((current) => [...current, ...files]);
  }

  function addFilesFromFileList(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    addFilesToComposer(Array.from(fileList));
  }

  function handlePasteAttachments(event: React.ClipboardEvent<HTMLDivElement | HTMLInputElement>) {
    const items = event.clipboardData?.items;
    if (!items || !selectedChatId) {
      return;
    }
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addFilesToComposer(files);
    }
  }

  async function handleCreateAvatarChange(file: File | null) {
    if (!file) {
      setChatAvatarDataUrl("");
      return;
    }
    try {
      setChatAvatarDataUrl(await fileToDataUrl(file));
    } catch {
      setStatus("Не удалось загрузить аватар");
    }
  }

  async function handleCreateBackgroundChange(file: File | null) {
    if (!file) {
      setChatBackgroundDataUrl("");
      return;
    }
    try {
      setChatBackgroundDataUrl(await fileToDataUrl(file));
    } catch {
      setStatus("Не удалось загрузить фон");
    }
  }

  async function handleEditAvatarChange(file: File | null) {
    if (!file) {
      setEditChatAvatarDataUrl("");
      return;
    }
    try {
      setEditChatAvatarDataUrl(await fileToDataUrl(file));
    } catch {
      setStatus("Не удалось загрузить аватар");
    }
  }

  async function handleEditBackgroundChange(file: File | null) {
    if (!file) {
      setEditChatBackgroundDataUrl("");
      return;
    }
    try {
      setEditChatBackgroundDataUrl(await fileToDataUrl(file));
    } catch {
      setStatus("Не удалось загрузить фон");
    }
  }

  async function handleSaveGroupChatSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId || selectedChat?.type !== "group") {
      return;
    }
    const nextTitle = editChatTitle.trim();
    if (!nextTitle) {
      setStatus("Укажи название группы");
      return;
    }
    setStatus("Обновляем настройки чата...");
    try {
      await updateGroupChat(token, selectedChatId, {
        title: nextTitle,
        avatar_url: editChatAvatarDataUrl || null,
        background_url: editChatBackgroundDataUrl || null,
      });
      await reloadChats();
      setChatSettingsModalOpen(false);
      setStatus("Настройки обновлены");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить настройки чата");
    }
  }

  function handleTogglePin(chatId: string) {
    setPinnedChatIds((current) => {
      if (current.includes(chatId)) {
        return current.filter((item) => item !== chatId);
      }
      return [chatId, ...current];
    });
  }

  function renderChatRow(chat: Chat) {
    const chatMeta = getChatPresentation(chat, me);
    const isPinned = pinnedChatSet.has(chat.id);
    const cachedMessages = chatMessagesCacheRef.current[chat.id] ?? [];
    const lastMessage = cachedMessages.length > 0 ? cachedMessages[cachedMessages.length - 1] : null;
    const previewText = getChatListPreview(chat, lastMessage, decodedMessagesCacheRef.current[chat.id]);
    const chatTime = formatChatListTime(lastMessage?.created_at ?? chat.updated_at);
    return (
      <div className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`} key={chat.id}>
        <button
          className="chat-row-main"
          onClick={() => {
            setSelectedChatId(chat.id);
            if (isMobile) {
              setMobileChatOpen(true);
            }
          }}
          type="button"
        >
          <div className="chat-row-avatar">
            {chatMeta.avatarUrl ? <img alt={chatMeta.title} src={chatMeta.avatarUrl} /> : chatMeta.initials}
          </div>
          <div className="chat-row-body">
            <div className="chat-row-line">
              <strong>{chatMeta.title}</strong>
              <time>{chatTime}</time>
            </div>
            <div className="chat-row-line">
              <span>{previewText}</span>
              {chat.unread_count > 0 ? <small className="chat-row-badge">{chat.unread_count}</small> : null}
            </div>
          </div>
        </button>
        <div className="chat-row-actions">
          <button
            aria-label={isPinned ? "Открепить чат" : "Закрепить чат"}
            className="chat-row-icon"
            onClick={() => handleTogglePin(chat.id)}
            type="button"
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            aria-label="Выйти из чата"
            className="chat-row-icon"
            onClick={() => void handleLeaveChat(chat)}
            type="button"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    );
  }

  async function handleLeaveChat(chat: Chat) {
    const title = getChatPresentation(chat, me).title;
    if (!window.confirm(`Выйти из чата "${title}"?`)) {
      return;
    }

    if (chat.type === "group") {
      setStatus("Выходим из чата...");
      try {
        await removeGroupMember(token, chat.id, me.id);
        setPinnedChatIds((current) => current.filter((item) => item !== chat.id));
        setChatInfoModalOpen(false);
        setChatSettingsModalOpen(false);
        await reloadChats();
        setStatus("");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Не удалось выйти из чата");
      }
      return;
    }

    setHiddenChatIds((current) => (current.includes(chat.id) ? current : [...current, chat.id]));
    setPinnedChatIds((current) => current.filter((item) => item !== chat.id));
    setStatus("");
  }

  function handleChatPaneDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }
    setComposerDragActive(true);
  }

  function handleChatPaneDragLeave(event: React.DragEvent<HTMLDivElement>) {
    const related = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(related)) {
      setComposerDragActive(false);
    }
  }

  function handleChatPaneDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }
    setComposerDragActive(false);
    addFilesFromFileList(event.dataTransfer.files);
  }

  return (
    <section className={`chat-band ${isMobile ? "mobile-mode" : ""} ${mobileChatOpen ? "mobile-chat-open" : ""}`}>
      <div className={`chat-list-pane ${isMobile && mobileChatOpen ? "mobile-hidden" : ""}`}>
        <div className="chat-list-header">
          <h2>Чаты</h2>
          <button
            aria-label="Создать чат"
            className={`create-chat-fab ${createChatOpen ? "open" : ""}`}
            onClick={() => setCreateChatOpen(true)}
            type="button"
          >
            <Pencil size={16} />
          </button>
        </div>

        {createChatOpen ? (
          <div
            className="create-chat-modal-overlay"
            onClick={() => {
              setCreateChatOpen(false);
              setCreateParticipantsDropdownOpen(false);
            }}
          >
            <div className="create-chat-modal" onClick={(event) => event.stopPropagation()}>
              <div className="create-chat-modal-header">
                <h3>Создать чат</h3>
                <button
                  aria-label="Закрыть"
                  className="create-chat-modal-close"
                  onClick={() => {
                    setCreateChatOpen(false);
                    setCreateParticipantsDropdownOpen(false);
                  }}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <form className="create-chat-form" onSubmit={handleCreateChat}>
                <div className="friend-select" ref={createParticipantsDropdownRef}>
                  <button
                    className="friend-select-trigger"
                    onClick={() => setCreateParticipantsDropdownOpen((open) => !open)}
                    type="button"
                  >
                    <span>{chatParticipants.length > 0 ? chatParticipants.join(", ") : "Выбери участников"}</span>
                    <ChevronDown size={16} />
                  </button>
                  <div className={`friend-select-dropdown ${createParticipantsDropdownOpen ? "open" : ""}`}>
                    {friends.map((friend) => (
                      <button
                        className={`friend-select-item ${chatParticipants.includes(friend.username) ? "selected" : ""}`}
                        key={friend.id}
                        onClick={() => toggleParticipant(friend.username)}
                        type="button"
                      >
                        {friend.username}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  className="compact-input"
                  maxLength={120}
                  onChange={(event) => setCreateChatTitle(event.target.value)}
                  placeholder="Название группы"
                  value={createChatTitle}
                />

                <div className="create-chat-media">
                  <button onClick={() => avatarInputRef.current?.click()} type="button">
                    Аватар чата
                  </button>
                  <button onClick={() => backgroundInputRef.current?.click()} type="button">
                    Фон чата (необязательно)
                  </button>
                  <input
                    accept="image/*"
                    className="visually-hidden"
                    onChange={(event) => void handleCreateAvatarChange(event.target.files?.[0] ?? null)}
                    ref={avatarInputRef}
                    type="file"
                  />
                  <input
                    accept="image/*"
                    className="visually-hidden"
                    onChange={(event) => void handleCreateBackgroundChange(event.target.files?.[0] ?? null)}
                    ref={backgroundInputRef}
                    type="file"
                  />
                </div>

                {chatAvatarDataUrl || chatBackgroundDataUrl ? (
                  <div className="create-chat-previews">
                    {chatAvatarDataUrl ? (
                      <div className="create-chat-preview-card">
                        <span>Аватар</span>
                        <img alt="Аватар чата" src={chatAvatarDataUrl} />
                      </div>
                    ) : null}
                    {chatBackgroundDataUrl ? (
                      <div className="create-chat-preview-card">
                        <span>Фон</span>
                        <img alt="Фон чата" src={chatBackgroundDataUrl} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button type="submit">Создать чат</button>
              </form>
            </div>
          </div>
        ) : null}

        <div className="chat-list">
          {pinnedChats.length > 0 ? (
            <div className="pinned-chat-section">
              <div className="pinned-chat-section-head">
                <span>Закрепленные</span>
              </div>
              <div className="pinned-chat-list">{pinnedChats.map(renderChatRow)}</div>
            </div>
          ) : null}
          <div className="regular-chat-list">{regularChats.map(renderChatRow)}</div>
          {chatsLoading && orderedChats.length === 0 ? <p className="form-status">Загружаем чаты...</p> : null}
          {!chatsLoading && orderedChats.length === 0 ? <p className="form-status">Чатов пока нет</p> : null}
        </div>
      </div>

      <div
        className={`chat-pane ${composerDragActive ? "drag-active" : ""} ${isMobile && !mobileChatOpen ? "mobile-hidden" : ""}`}
        onDragLeave={handleChatPaneDragLeave}
        onDragOver={handleChatPaneDragOver}
        onDrop={handleChatPaneDrop}
        onPaste={handlePasteAttachments}
        style={chatPaneStyle}
      >
        {selectedChatMeta ? (
          <div className="chat-pane-header">
            <div className="chat-head-left">
              {isMobile ? (
                <button
                  aria-label="Назад к списку чатов"
                  className="chat-back-button mobile-only"
                  onClick={() => setMobileChatOpen(false)}
                  type="button"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : null}
              <div className="chat-pane-avatar">
                {selectedChatMeta.avatarUrl ? <img alt={selectedChatMeta.title} src={selectedChatMeta.avatarUrl} /> : selectedChatMeta.initials}
              </div>
              <button className="chat-meta-pill" onClick={() => setChatInfoModalOpen(true)} type="button">
                <strong>{selectedChatMeta.title}</strong>
                <span>{selectedChatMeta.subtitle}</span>
              </button>
            </div>
            {selectedChat?.type === "group" ? (
              <button
                aria-label="Настройки чата"
                className="chat-pane-settings-button"
                onClick={() => setChatSettingsModalOpen(true)}
                type="button"
              >
                <MoreHorizontal size={18} />
              </button>
            ) : null}
          </div>
        ) : (
          <h2>Сообщения</h2>
        )}

        {chatInfoModalOpen && selectedChat ? (
          <div className="create-chat-modal-overlay" onClick={() => setChatInfoModalOpen(false)}>
            <div className="create-chat-modal chat-meta-modal" onClick={(event) => event.stopPropagation()}>
              <div className="create-chat-modal-header">
                <h3>Информация о чате</h3>
                <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setChatInfoModalOpen(false)} type="button">
                  <X size={16} />
                </button>
              </div>
              <div className="chat-meta-profile">
                <div className="chat-pane-avatar">
                  {selectedChatMeta?.avatarUrl ? (
                    <img alt={selectedChatMeta.title} src={selectedChatMeta.avatarUrl} />
                  ) : (
                    selectedChatMeta?.initials
                  )}
                </div>
                <div className="chat-pane-meta">
                  <h2>{selectedChatMeta?.title}</h2>
                  <span>{selectedChat.members.length} участников</span>
                </div>
              </div>
              <div className="result-list">
                {selectedChat.members.map((member) => (
                  <div className="result-row" key={member.user.id}>
                    <span>
                      {member.user.username} · {humanizeStatus(member.user.status)}
                    </span>
                    <span>{member.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {chatSettingsModalOpen && selectedChat?.type === "group" ? (
          <div className="create-chat-modal-overlay" onClick={() => setChatSettingsModalOpen(false)}>
            <div className="create-chat-modal chat-settings-modal" onClick={(event) => event.stopPropagation()}>
              <div className="create-chat-modal-header">
                <h3>Настройки чата</h3>
                <button aria-label="Закрыть" className="create-chat-modal-close" onClick={() => setChatSettingsModalOpen(false)} type="button">
                  <X size={16} />
                </button>
              </div>
              <form className="create-chat-form" onSubmit={handleSaveGroupChatSettings}>
                <input
                  className="compact-input"
                  maxLength={120}
                  onChange={(event) => setEditChatTitle(event.target.value)}
                  placeholder="Название группы"
                  value={editChatTitle}
                />
                <div className="create-chat-media">
                  <button disabled={!canManageMembers} onClick={() => editAvatarInputRef.current?.click()} type="button">
                    Аватар чата
                  </button>
                  <button disabled={!canManageMembers} onClick={() => editBackgroundInputRef.current?.click()} type="button">
                    Фон чата
                  </button>
                  <input
                    accept="image/*"
                    className="visually-hidden"
                    onChange={(event) => void handleEditAvatarChange(event.target.files?.[0] ?? null)}
                    ref={editAvatarInputRef}
                    type="file"
                  />
                  <input
                    accept="image/*"
                    className="visually-hidden"
                    onChange={(event) => void handleEditBackgroundChange(event.target.files?.[0] ?? null)}
                    ref={editBackgroundInputRef}
                    type="file"
                  />
                </div>
                {editChatAvatarDataUrl || editChatBackgroundDataUrl ? (
                  <div className="create-chat-previews">
                    {editChatAvatarDataUrl ? (
                      <div className="create-chat-preview-card">
                        <span>Аватар</span>
                        <img alt="Аватар чата" src={editChatAvatarDataUrl} />
                      </div>
                    ) : null}
                    {editChatBackgroundDataUrl ? (
                      <div className="create-chat-preview-card">
                        <span>Фон</span>
                        <img alt="Фон чата" src={editChatBackgroundDataUrl} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button disabled={!canManageMembers} type="submit">
                  Сохранить
                </button>
              </form>
              <div className="result-list">
                <p className="form-status">Моя роль: {myMember?.role ?? "member"}</p>
                {canManageMembers ? (
                  <form className="inline-form" onSubmit={handleAddMember}>
                    <input
                      maxLength={32}
                      minLength={3}
                      onChange={(event) => setMemberUsername(event.target.value)}
                      placeholder="Username участника"
                      required
                      value={memberUsername}
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
          {messagesLoading ? <p className="form-status">Загружаем сообщения...</p> : null}
          {messages.map((message) => (
            <div
              className={`message message-enter ${message.sender.id === me.id ? "mine" : ""}`}
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
                <p>{decodeMap[message.id] ?? ""}</p>
              )}
            </div>
          ))}
          {selectedChatId && !messagesLoading && messages.length === 0 ? <p className="form-status">Пока нет сообщений</p> : null}
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

        <form className="composer-form" onSubmit={handleSendComposer}>
          <input
            accept="*/*"
            className="visually-hidden"
            multiple
            onChange={(event) => {
              addFilesFromFileList(event.target.files);
              event.currentTarget.value = "";
            }}
            ref={attachmentInputRef}
            type="file"
          />
          <button
            aria-label="Прикрепить файл"
            className="composer-icon-button"
            disabled={!selectedChatId || isSendingMessage}
            onClick={() => attachmentInputRef.current?.click()}
            type="button"
          >
            <Paperclip size={16} />
          </button>
          <input
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="Сообщение"
            value={messageText}
          />
          <button
            disabled={!selectedChatId || isSendingMessage || (!messageText.trim() && attachmentFiles.length === 0)}
            type="submit"
          >
            {isSendingMessage ? "Отправка..." : "Отправить"}
          </button>
        </form>

        {attachmentFiles.length > 0 ? (
          <div className="attachment-list">
            {attachmentFiles.map((file, index) => (
              <div className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                <span>{file.name}</span>
                <button
                  aria-label="Убрать файл"
                  onClick={() => setAttachmentFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <p className={`form-status composer-status ${status ? "visible" : ""}`}>{status || " "}</p>

        {previewMediaUrl && previewMediaType.startsWith("image/") ? (
          <div
            className="media-preview-overlay"
            onClick={() => {
              setPreviewMediaUrl(null);
              setPreviewMediaType("");
            }}
            role="button"
            tabIndex={0}
          >
            <div className="media-preview-dialog media-preview-dialog-image" onClick={(event) => event.stopPropagation()}>
              <img alt="Медиа" className="media-preview-view media-preview-view-image" decoding="async" loading="eager" src={previewMediaUrl} />
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
  const mediaPayloadFiles = React.useMemo(() => parseMediaPayloadFiles(raw), [raw]);
  const [resolvedFiles, setResolvedFiles] = React.useState<Array<{ payload: MediaPayloadFile; url: string }>>([]);
  const [mediaError, setMediaError] = React.useState<string>("");

  React.useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];

    async function resolveMedia() {
      if (!mediaPayloadFiles || !chatId) {
        return;
      }
      try {
        const chatKey = await ensureChatKey(chatId);
        const nextFiles: Array<{ payload: MediaPayloadFile; url: string }> = [];
        for (const payload of mediaPayloadFiles) {
          const response = await fetch(payload.media_url, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!response.ok) {
            throw new Error(`Не удалось загрузить медиа (${response.status})`);
          }
          const encryptedBytes = new Uint8Array(await response.arrayBuffer());
          const decryptedBytes = await decryptBytesWithSharedKey(encryptedBytes, payload.file_nonce, chatKey);
          const safeBytes = new Uint8Array(decryptedBytes.byteLength);
          safeBytes.set(decryptedBytes);
          const blob = new Blob([safeBytes.buffer], { type: payload.file_mime || "application/octet-stream" });
          const fileUrl = URL.createObjectURL(blob);
          urlsToRevoke.push(fileUrl);
          nextFiles.push({ payload, url: fileUrl });
        }
        if (active) {
          setResolvedFiles(nextFiles);
          setMediaError("");
          onMediaReady();
        }
      } catch (error) {
        if (active) {
          setMediaError(error instanceof Error ? error.message : "Не удалось показать медиа");
          setResolvedFiles([]);
        }
      }
    }

    void resolveMedia();
    return () => {
      active = false;
      for (const url of urlsToRevoke) {
        URL.revokeObjectURL(url);
      }
    };
  }, [chatId, mediaPayloadFiles, onMediaReady, token]);

  if (!mediaPayloadFiles) {
    return <p>{raw || "..."}</p>;
  }

  const isGallery = resolvedFiles.length > 1;

  return (
    <div className={`media-message ${isGallery ? "gallery" : ""}`}>
      {mediaError ? <p>{mediaError}</p> : null}
      {!mediaError && resolvedFiles.length === 0 ? <p>Загружаем медиа...</p> : null}
      {resolvedFiles.map(({ payload, url }) => {
        const isImage = payload.file_mime.startsWith("image/");
        const isVideo = payload.file_mime.startsWith("video/");
        const isAudio = payload.file_mime.startsWith("audio/");
        return (
          <div className="media-item" key={payload.media_id || `${payload.file_name}-${payload.file_nonce}`}>
            {isImage ? (
              <button className="media-inline-trigger" onClick={() => onPreview(url, payload.file_mime)} type="button">
                <img alt={payload.file_name} className="media-inline-preview" decoding="async" loading="lazy" src={url} />
              </button>
            ) : null}
            {isVideo ? (
              <video
                className="media-inline-video"
                controls
                loop
                muted
                playsInline
                preload="metadata"
                src={url}
              />
            ) : null}
            {isAudio ? <audio className="media-inline-audio" controls src={url} /> : null}
            {!isImage && !isVideo && !isAudio ? (
              <a className="media-file-link" download={payload.file_name} href={url} rel="noreferrer" target="_blank">
                {payload.file_name}
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function parseMediaPayloadFiles(raw: string): MediaPayloadFile[] | null {
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw) as
      | { kind?: string; files?: Partial<MediaPayloadFile>[] }
      | Partial<MediaPayloadFile>;
    if (payload && typeof payload === "object" && "kind" in payload && payload.kind === "media_batch" && Array.isArray(payload.files)) {
      const files = payload.files
        .map((item) => normalizeMediaPayloadFile(item))
        .filter((item): item is MediaPayloadFile => item !== null);
      return files.length > 0 ? files : null;
    }
    const legacy = normalizeMediaPayloadFile(payload as Partial<MediaPayloadFile>);
    if (!legacy) {
      return null;
    }
    return [legacy];
  } catch {
    return null;
  }
}

function normalizeMediaPayloadFile(payload: Partial<MediaPayloadFile> | null | undefined): MediaPayloadFile | null {
  if (!payload || typeof payload.media_url !== "string" || typeof payload.file_name !== "string") {
    return null;
  }
  return {
    media_id: payload.media_id ?? "",
    media_url: payload.media_url,
    file_name: payload.file_name,
    file_size: typeof payload.file_size === "number" ? payload.file_size : 0,
    file_mime: payload.file_mime ?? "application/octet-stream",
    file_nonce: payload.file_nonce ?? "",
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function loadStoredThemeId(): string {
  const fallback = SITE_THEMES[0].id;
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved) {
      return fallback;
    }
    return SITE_THEMES.some((theme) => theme.id === saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredDashboardSection(): DashboardSection {
  const fallback: DashboardSection = "home";
  try {
    const saved = localStorage.getItem(DASHBOARD_SECTION_STORAGE_KEY);
    if (!saved) {
      return fallback;
    }
    return isDashboardSection(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredSelectedProfile(): UserPublic | null {
  try {
    const raw = localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UserPublic>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || typeof parsed.username !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      username: parsed.username,
      display_name: typeof parsed.display_name === "string" ? parsed.display_name : null,
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : null,
      profile_status: typeof parsed.profile_status === "string" ? parsed.profile_status : null,
      profile_banner_url: typeof parsed.profile_banner_url === "string" ? parsed.profile_banner_url : null,
      profile_background_url: typeof parsed.profile_background_url === "string" ? parsed.profile_background_url : null,
      profile_photos: typeof parsed.profile_photos === "string" ? parsed.profile_photos : null,
      avatar_ring_style: typeof parsed.avatar_ring_style === "string" ? parsed.avatar_ring_style : null,
      avatar_url: typeof parsed.avatar_url === "string" ? parsed.avatar_url : null,
      status: typeof parsed.status === "string" ? parsed.status : "offline",
      current_game: typeof parsed.current_game === "string" ? parsed.current_game : null,
    };
  } catch {
    return null;
  }
}

function isDashboardSection(value: string): value is DashboardSection {
  return (
    value === "profile" ||
    value === "home" ||
    value === "chats" ||
    value === "friends" ||
    value === "games" ||
    value === "clips" ||
    value === "settings"
  );
}

function applyTheme(theme: SiteTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const vars = buildThemeVars(theme);
  const root = document.documentElement;
  Object.entries(vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

function buildThemeVars(theme: SiteTheme): Record<string, string> {
  return {
    "--color-bg": theme.background,
    "--color-surface": theme.surface,
    "--color-text": theme.text,
    "--color-accent": theme.accent,
    "--color-accent-2": theme.secondaryAccent,
    "--color-surface-strong": mixHex(theme.surface, theme.background, 0.44),
    "--color-surface-deep": mixHex(theme.surface, "#000000", 0.42),
    "--color-input": mixHex(theme.surface, "#000000", 0.2),
    "--color-text-muted": mixHex(theme.text, theme.surface, 0.34),
    "--color-button-text": pickReadableText(theme.accent),
    "--color-border": theme.secondaryAccent,
    "--color-accent-hover": mixHex(theme.secondaryAccent, "#000000", 0.16),
  };
}

function pickReadableText(backgroundHex: string): string {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) {
    return "#0F0F0F";
  }
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.55 ? "#111111" : "#F8F8F8";
}

function mixHex(firstHex: string, secondHex: string, ratio: number): string {
  const first = hexToRgb(firstHex);
  const second = hexToRgb(secondHex);
  if (!first || !second) {
    return firstHex;
  }
  const safeRatio = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: Math.round(first.r * (1 - safeRatio) + second.r * safeRatio),
    g: Math.round(first.g * (1 - safeRatio) + second.g * safeRatio),
    b: Math.round(first.b * (1 - safeRatio) + second.b * safeRatio),
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function getChatPresentation(chat: Chat, me: CurrentUser): {
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  initials: string;
} {
  if (chat.type === "direct") {
    const peer = chat.members.find((member) => member.user.id !== me.id)?.user ?? null;
    const title = peer?.username ?? "Личный чат";
    return {
      title,
      subtitle: "1 на 1",
      avatarUrl: peer?.avatar_url ?? null,
      initials: title.slice(0, 1).toUpperCase(),
    };
  }
  const title = chat.title?.trim() || "Группа";
  return {
    title,
    subtitle: `${chat.members.length} участника`,
    avatarUrl: chat.avatar_url,
    initials: title.slice(0, 1).toUpperCase(),
  };
}

function readStoredStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeStoredStringList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // ignore storage write errors
  }
}

function readStoredChats(userId: string): Chat[] {
  try {
    const raw = localStorage.getItem(`${CHATS_CACHE_PREFIX}${userId}`);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as Chat[];
  } catch {
    return [];
  }
}

function readStoredSelectedChatId(userId: string): string {
  try {
    return localStorage.getItem(`${SELECTED_CHAT_STORAGE_KEY_PREFIX}${userId}`) ?? "";
  } catch {
    return "";
  }
}

function writeStoredSelectedChatId(userId: string, chatId: string): void {
  try {
    const storageKey = `${SELECTED_CHAT_STORAGE_KEY_PREFIX}${userId}`;
    if (!chatId) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, chatId);
  } catch {
    // ignore storage write errors
  }
}

function writeStoredChats(userId: string, chats: Chat[]): void {
  try {
    localStorage.setItem(`${CHATS_CACHE_PREFIX}${userId}`, JSON.stringify(chats));
  } catch {
    // ignore storage write errors
  }
}

function dedupeMessagesById(items: Message[]): Message[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("Failed to convert file to data URL"));
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatChatListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getChatListPreview(
  chat: Chat,
  lastMessage: Message | null,
  decodedMap: Record<string, string> | undefined,
): string {
  if (!lastMessage) {
    return chat.type === "group" ? `${chat.members.length} участника` : "Личный чат";
  }
  if (lastMessage.message_type === "media") {
    return "Вложение";
  }
  const decoded = decodedMap?.[lastMessage.id]?.trim();
  if (!decoded) {
    return "Новое сообщение";
  }
  return decoded.replace(/\s+/g, " ").slice(0, 48);
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
