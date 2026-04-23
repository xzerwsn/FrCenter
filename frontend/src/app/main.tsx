import React from "react";
import ReactDOM from "react-dom/client";
import {
  Bell,
  ChevronDown,
  Gamepad2,
  Home,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  PlaySquare,
  Settings,
  UserRound,
  Users,
  X,
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
  updateGroupChat,
  updateChatMessage,
  updateGroupMemberRole,
} from "../api/chats";
import { registerDevice } from "../api/devices";
import { addFriendByCode, createInviteCode, listFriends, searchUsers, sendFriendRequest } from "../api/friends";
import { uploadEncryptedMedia } from "../api/media";
import { connectRealtime, type RealtimeEvent } from "../api/realtime";
import { getMe, updateMe, type CurrentUser, type UserPublic } from "../api/users";
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
const PINNED_CHATS_STORAGE_KEY = "frcenter.pinnedChats";
const HIDDEN_CHATS_STORAGE_KEY = "frcenter.hiddenChats";
const THEME_STORAGE_KEY = "frcenter.siteTheme";
const DASHBOARD_SECTION_STORAGE_KEY = "frcenter.dashboardSection";

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
    id: "chinese-black-warm-accents",
    name: "Китайский чёрный (Chinese Black & Warm Accents)",
    background: "#0C1519",
    surface: "#162127",
    text: "#3A3534",
    accent: "#724B39",
    secondaryAccent: "#CF9D7B",
  },
  {
    id: "night-sky-palette",
    name: "Ночное небо (Palette)",
    background: "#252330",
    surface: "#3B3A4A",
    text: "#F5F9F8",
    accent: "#575669",
    secondaryAccent: "#595168",
  },
  {
    id: "ocean",
    name: "Океан (Ocean)",
    background: "#24292E",
    surface: "#4A5156",
    text: "#808A92",
    accent: "#BDC7CE",
    // Ocean palette in request includes 4 unique HEX values, so secondary accent reuses Blue Dolphin.
    secondaryAccent: "#808A92",
  },
  {
    id: "ashes",
    name: "Пепел (Ashes)",
    background: "#B7B4AE",
    surface: "#726E68",
    text: "#33312F",
    accent: "#371E1E",
    secondaryAccent: "#0A0A0A",
  },
  {
    id: "back-in-black",
    name: "Снова в чёрном (Back in Black)",
    background: "#16131F",
    surface: "#F0D9E4",
    text: "#C1A0AC",
    accent: "#4A3F4B",
    secondaryAccent: "#806C79",
  },
  {
    id: "berries",
    name: "Ягоды (Berries)",
    background: "#1D2B38",
    surface: "#526161",
    text: "#6F3742",
    accent: "#B6ADA2",
    secondaryAccent: "#C36765",
  },
  {
    id: "northern-lights",
    name: "Северное сияние (Northern Lights)",
    background: "#1F0922",
    surface: "#4B2B55",
    text: "#6F7074",
    accent: "#89B199",
    secondaryAccent: "#CAD5D4",
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
  const [selectedProfile, setSelectedProfile] = React.useState<UserPublic | CurrentUser | null>(null);

  React.useEffect(() => {
    void listFriends(session.token).then((response) => setFriends(response.friends));
  }, [session.token]);

  React.useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_SECTION_STORAGE_KEY, section);
    } catch {
      // ignore storage write errors
    }
  }, [section]);

  function openOwnProfile() {
    setSelectedProfile(null);
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

        {section === "profile" ? (
          <ProfilePanel
            token={session.token}
            profile={selectedProfile && selectedProfile.id !== session.user.id ? selectedProfile : session.user}
            sessionUser={session.user}
            onSessionUserUpdate={onSessionUserUpdate}
          />
        ) : null}
        {section === "home" ? <HomePanel friends={friends} /> : null}
        {section === "chats" ? <ChatsPanel token={session.token} me={session.user} friends={friends} /> : null}
        {section === "friends" ? (
          <FriendsPanel token={session.token} onFriendsChanged={setFriends} onOpenProfile={openFriendProfile} />
        ) : null}
        {section === "notifications" ? <NotificationsPanel /> : null}
        {section === "games" ? <GamesPanel friends={friends} /> : null}
        {section === "clips" ? <ClipsPanel friends={friends} /> : null}
        {section === "settings" ? <SettingsPanel themeId={themeId} onThemeChange={onThemeChange} /> : null}
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

function ProfilePanel({
  token,
  profile,
  sessionUser,
  onSessionUserUpdate,
}: {
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
  const [nickname, setNickname] = React.useState(sessionUser.nickname ?? "");
  const [profileStatusText, setProfileStatusText] = React.useState(sessionUser.profile_status ?? "");
  const [avatarUrl, setAvatarUrl] = React.useState(sessionUser.avatar_url ?? "");
  const [bannerUrl, setBannerUrl] = React.useState(sessionUser.profile_banner_url ?? "");
  const [backgroundUrl, setBackgroundUrl] = React.useState(sessionUser.profile_background_url ?? "");
  const [ringStyle, setRingStyle] = React.useState(sessionUser.avatar_ring_style ?? "holo");
  const [profilePhotos, setProfilePhotos] = React.useState<string[]>(sessionUser.profile_photos ?? []);
  const [statusText, setStatusText] = React.useState("");
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const bannerInputRef = React.useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const galleryInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!isOwnProfile) {
      return;
    }
    setDisplayName(sessionUser.display_name ?? "");
    setUsername(sessionUser.username);
    setNickname(sessionUser.nickname ?? "");
    setProfileStatusText(sessionUser.profile_status ?? "");
    setAvatarUrl(sessionUser.avatar_url ?? "");
    setBannerUrl(sessionUser.profile_banner_url ?? "");
    setBackgroundUrl(sessionUser.profile_background_url ?? "");
    setRingStyle(sessionUser.avatar_ring_style ?? "holo");
    setProfilePhotos(sessionUser.profile_photos ?? []);
  }, [
    isOwnProfile,
    sessionUser.avatar_ring_style,
    sessionUser.avatar_url,
    sessionUser.display_name,
    sessionUser.nickname,
    sessionUser.profile_background_url,
    sessionUser.profile_banner_url,
    sessionUser.profile_photos,
    sessionUser.profile_status,
    sessionUser.username,
  ]);

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

  async function handleProfileGalleryPick(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    try {
      const next = await Promise.all(Array.from(fileList).map((file) => fileToDataUrl(file)));
      setProfilePhotos((current) => [...current, ...next].slice(0, 30));
    } catch {
      setStatusText("Не удалось загрузить фотографии профиля");
    }
  }

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwnProfile) {
      return;
    }
    setStatusText("Сохраняем профиль...");
    try {
      const updated = await updateMe(token, {
        display_name: displayName.trim() || null,
        username: username.trim() || sessionUser.username,
        nickname: nickname.trim() || null,
        profile_status: profileStatusText.trim() || null,
        avatar_url: avatarUrl || null,
        profile_banner_url: bannerUrl || null,
        profile_background_url: backgroundUrl || null,
        avatar_ring_style: ringStyle || null,
        profile_photos: profilePhotos,
      });
      onSessionUserUpdate(updated);
      setStatusText("Профиль обновлен");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось обновить профиль");
    }
  }

  return (
    <section className="tool-band profile-band">
      <div className="profile-panel">
        <h2>Профиль</h2>
        <div
          className="profile-header-card"
          style={backgroundUrl ? { backgroundImage: `linear-gradient(rgb(19 17 29 / 74%), rgb(19 17 29 / 82%)), url("${backgroundUrl}")` } : undefined}
        >
          {bannerUrl ? <img alt="Баннер профиля" className="profile-banner-image" src={bannerUrl} /> : null}
          <div className={`profile-avatar-ring ring-${ringStyle || "holo"}`}>
            <div className="profile-avatar-core">
              {avatarUrl ? <img alt={profile.username} src={avatarUrl} /> : <span>{profile.username.slice(0, 1).toUpperCase()}</span>}
            </div>
          </div>
          <div className="profile-main-meta">
            <strong>{displayName || profile.display_name || profile.username}</strong>
            <span>@{username || profile.username}</span>
            <span>{profileStatusText || profile.profile_status || humanizeStatus(status)}</span>
          </div>
        </div>
        <div className="result-row">
          <span>
            <b>{profile.username}</b> · {status}
          </span>
          <UserRound size={18} />
        </div>
        <p className="form-status">Текущая игра: {game}</p>
        {"email" in profile ? <p className="form-status">Email: {profile.email}</p> : null}
        <p className="form-status">ID: {profile.id}</p>
      </div>
      <div className="profile-settings-panel">
        {isOwnProfile ? (
          <form className="auth-form profile-edit-form" onSubmit={handleSaveProfile}>
            <label>
              Имя
              <input maxLength={120} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
            </label>
            <label>
              Никнейм
              <input maxLength={32} minLength={3} onChange={(event) => setUsername(event.target.value)} value={username} />
            </label>
            <label>
              @Тег
              <input maxLength={32} onChange={(event) => setNickname(event.target.value)} value={nickname} />
            </label>
            <label>
              Статус
              <input maxLength={160} onChange={(event) => setProfileStatusText(event.target.value)} value={profileStatusText} />
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
              <button onClick={() => galleryInputRef.current?.click()} type="button">
                Фото профиля
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
            <input
              accept="image/*"
              className="visually-hidden"
              multiple
              onChange={(event) => void handleProfileGalleryPick(event.target.files)}
              ref={galleryInputRef}
              type="file"
            />
            {profilePhotos.length > 0 ? (
              <div className="profile-photo-grid">
                {profilePhotos.map((photo, index) => (
                  <div className="profile-photo-card" key={`${photo.slice(0, 24)}-${index}`}>
                    <img alt={`Фото ${index + 1}`} src={photo} />
                    <button onClick={() => setProfilePhotos((current) => current.filter((_, item) => item !== index))} type="button">
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="submit">Сохранить профиль</button>
            {statusText ? <p className="form-status">{statusText}</p> : null}
          </form>
        ) : (
          <div className="result-list">
            <div className="result-row">
              <span>Имя</span>
              <span>{profile.display_name || profile.username}</span>
            </div>
            <div className="result-row">
              <span>Ник</span>
              <span>{profile.nickname ? `@${profile.nickname}` : "не указан"}</span>
            </div>
            <div className="result-row">
              <span>Статус профиля</span>
              <span>{profile.profile_status || humanizeStatus(profile.status)}</span>
            </div>
          </div>
        )}
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
  themeId,
  onThemeChange,
}: {
  themeId: string;
  onThemeChange: (themeId: string) => void;
}) {
  const [autoStart, setAutoStart] = React.useState(false);
  const [notifEnabled, setNotifEnabled] = React.useState(true);

  return (
    <section className="tool-band">
      <div>
        <h2>Темы</h2>
        <div className="theme-grid">
          {SITE_THEMES.map((theme) => (
            <button
              className={`theme-card ${themeId === theme.id ? "active" : ""}`}
              key={theme.id}
              onClick={() => onThemeChange(theme.id)}
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
      <div>
        <p className="form-status">1 цвет: фон сайта</p>
        <p className="form-status">2 цвет: карточки, хедер, футер</p>
        <p className="form-status">3 цвет: текст и иконки</p>
        <p className="form-status">4 цвет: кнопки, ссылки, активные элементы</p>
        <p className="form-status">5 цвет: hover, обводки, бейджи</p>
        <div className="result-list">
          <label className="result-row">
            <span>Запуск вместе с Windows</span>
            <input checked={autoStart} onChange={() => setAutoStart((v) => !v)} type="checkbox" />
          </label>
          <label className="result-row">
            <span>Уведомления</span>
            <input checked={notifEnabled} onChange={() => setNotifEnabled((v) => !v)} type="checkbox" />
          </label>
        </div>
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

  const createParticipantsDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const editAvatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const editBackgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);

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

  const selectedChat = orderedChats.find((chat) => chat.id === selectedChatId) ?? null;
  const selectedChatMeta = selectedChat ? getChatPresentation(selectedChat, me) : null;
  const myMember = selectedChat?.members.find((member) => member.user.id === me.id) ?? null;
  const canManageMembers = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const canManageRoles = selectedChat?.type === "group" && myMember?.role === "owner";
  const canModerateAllMessages = selectedChat?.type === "group" && (myMember?.role === "owner" || myMember?.role === "admin");
  const chatPaneStyle: React.CSSProperties | undefined = selectedChat?.background_url
    ? {
        backgroundImage: `linear-gradient(rgb(75 18 32 / 80%), rgb(75 18 32 / 90%)), url("${selectedChat.background_url}")`,
        backgroundSize: "100% 100%, cover",
        backgroundPosition: "center, center",
        backgroundRepeat: "no-repeat, no-repeat",
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
    if (orderedChats.length === 0) {
      if (selectedChatId) {
        setSelectedChatId("");
      }
      return;
    }
    if (orderedChats.some((chat) => chat.id === selectedChatId)) {
      return;
    }
    setSelectedChatId(orderedChats[0].id);
  }, [orderedChats, selectedChatId]);

  React.useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      setDecodeMap({});
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
      if (createParticipantsDropdownRef.current && !createParticipantsDropdownRef.current.contains(targetNode)) {
        setCreateParticipantsDropdownOpen(false);
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
    scrollToBottom();
  }, [messages.length, selectedChatId, scrollToBottom]);

  async function reloadChats() {
    const response = await listChats(token);
    setChats(response.chats);
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

  async function sendEncryptedText(text: string) {
    if (!selectedChatId) {
      throw new Error("Чат не выбран");
    }
    const key = await ensureChatKey(selectedChatId);
    const encrypted = await encryptTextForSharedKey(text, key);
    await sendChatMessage(token, selectedChatId, {
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

    try {
      if (text) {
        setStatus("Отправляем сообщение...");
        await sendEncryptedText(text);
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
          await sendChatMessage(token, selectedChatId, {
            ciphertext: encryptedPayload.ciphertext,
            nonce: encryptedPayload.nonce,
            message_type: "media",
          });
        }
      }
      setMessageText("");
      setAttachmentFiles([]);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отправить сообщение");
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
    <section className="chat-band">
      <div className="chat-list-pane">
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
          {orderedChats.map((chat) => {
            const chatMeta = getChatPresentation(chat, me);
            const isPinned = pinnedChatSet.has(chat.id);
            return (
              <div className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`} key={chat.id}>
                <button className="chat-row-main" onClick={() => setSelectedChatId(chat.id)} type="button">
                  <div className="chat-row-avatar">
                    {chatMeta.avatarUrl ? (
                      <img alt={chatMeta.title} src={chatMeta.avatarUrl} />
                    ) : (
                      chatMeta.initials
                    )}
                  </div>
                  <div className="chat-row-body">
                    <strong>{chatMeta.title}</strong>
                    <span>{chatMeta.subtitle}</span>
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
          })}
          {orderedChats.length === 0 ? <p className="form-status">Чатов пока нет</p> : null}
        </div>
      </div>

      <div
        className={`chat-pane ${composerDragActive ? "drag-active" : ""}`}
        onDragLeave={handleChatPaneDragLeave}
        onDragOver={handleChatPaneDragOver}
        onDrop={handleChatPaneDrop}
        onPaste={handlePasteAttachments}
        style={chatPaneStyle}
      >
        {selectedChatMeta ? (
          <div className="chat-pane-header">
            <div className="chat-head-left">
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
          {selectedChatId && messages.length === 0 ? <p className="form-status">Пока нет сообщений</p> : null}
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
            disabled={!selectedChatId}
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
          <button disabled={!selectedChatId || (!messageText.trim() && attachmentFiles.length === 0)} type="submit">
            Отправить
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

        {status ? <p className="form-status">{status}</p> : null}

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
              <img alt="Медиа" className="media-preview-view media-preview-view-image" src={previewMediaUrl} />
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
            headers: { Authorization: `Bearer ${token}` },
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
                <img alt={payload.file_name} className="media-inline-preview" src={url} />
              </button>
            ) : null}
            {isVideo ? <video className="media-inline-preview" controls src={url} /> : null}
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

function isDashboardSection(value: string): value is DashboardSection {
  return (
    value === "profile" ||
    value === "home" ||
    value === "chats" ||
    value === "friends" ||
    value === "notifications" ||
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
