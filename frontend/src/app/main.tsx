import React from "react";
import ReactDOM from "react-dom/client";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  Copy,
  Gamepad2,
  Home,
  LogOut,
  Mic,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  PlaySquare,
  Settings,
  Square,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { confirmEmail, login, logout, register } from "../api/auth";
import { ApiError } from "../api/client";
import {
  type Chat,
  type Message,
  addGroupMember,
  createDirectChat,
  createGroupChat,
  deleteChatMessage,
  listChatMessages,
  listChats,
  readChat,
  markChatRead,
  removeGroupMember,
  sendChatMessage,
  updateGroupChat,
  updateChatMessage,
  updateGroupMemberRole,
} from "../api/chats";
import {
  addFriendByCode,
  createInviteCode,
  listFriends,
} from "../api/friends";
import { listFeed, type FeedPublication } from "../api/feed";
import {
  disconnectGameAccount,
  getGamesOverview,
  type SteamOverview,
} from "../api/games";
import { uploadEncryptedMedia, uploadPublicMedia } from "../api/media";
import { getMe, updateMe, type CurrentUser, type ProfilePhoto, type UserPublic } from "../api/users";
import {
  getDefaultBackendHttpUrl,
  subscribeBackendUrl,
} from "../config/backend-url";
import { bytesToBase64 } from "../crypto/encoding";
import {
  decryptCacheEntriesInWorker,
  decryptMessagesInWorker,
  encryptCacheEntriesInWorker,
  encryptBytesForSharedKeyInWorker,
  encryptTextForSharedKeyInWorker,
  generateSharedKeyInWorker,
  resetCryptoWorkerSession,
} from "../crypto/worker-client";
import { clearDecodedMessagesCache, getCachedDecodedMessages, pruneDecodedMessages, upsertCachedDecodedMessages } from "./chat-cache";
import {
  CHAT_KEY_PREFIX,
  getChatMemberCount,
  getChatPresentation,
  mergeChatSummaries,
  readCachedChats,
  readStoredSelectedChatId,
  writeCachedChats,
  writeStoredSelectedChatId,
} from "./chat-store";
import { type MediaPayloadFile, VirtualMessageList } from "./chat-components";
import { DEFAULT_NOTIFICATION_SOUND_URL, useNotificationsStore } from "./notifications-store";
import { useRealtimeSubscription } from "./realtime-store";
import { clearSession, loadSession, saveSession, type Session } from "./session";
import { applyTheme, loadStoredThemeId, persistThemeId, SITE_THEMES, type SiteTheme } from "./settings-store";
import { parseJsonTextInWorker } from "./transport-worker-client";
import {
  cacheRecentMessagesInTauri,
  clearRecentMessagesInTauri,
  hasTauriIpc,
  invokeTauriCommand,
  loadRecentMessagesFromTauri,
} from "./tauri-bridge";
import "../styles/globals.css";
import frcenterIcon from "../assets/frcenter-icon.png";
import frcenterLoaderReference from "../assets/frcenter-loader-reference-v2.png";

type AuthMode = "login" | "register" | "confirm";
type DashboardSection = "profile" | "home" | "chats" | "friends" | "games" | "clips" | "settings";
const REQUIRED_BOOTSTRAP_SECTIONS: DashboardSection[] = ["home", "friends", "chats"];
const BOOTSTRAP_SECTION_SEQUENCE: DashboardSection[] = ["friends", "home", "chats"];
const FEED_CACHE_STORAGE_KEY_PREFIX = "frcenter.feedCache.";
const FRIENDS_CACHE_STORAGE_KEY_PREFIX = "frcenter.friendsCache.";
const BOOT_STAGE_BY_SECTION: Record<DashboardSection, string> = {
  profile: "Restoring profile shell",
  home: "Loading publications",
  chats: "Loading chat directory",
  friends: "Loading friends network",
  games: "Syncing game accounts",
  clips: "Preparing media gallery",
  settings: "Loading preferences",
};

const PINNED_CHATS_STORAGE_KEY = "frcenter.pinnedChats";
const HIDDEN_CHATS_STORAGE_KEY = "frcenter.hiddenChats";
const DASHBOARD_SECTION_STORAGE_KEY = "frcenter.dashboardSection";
const SELECTED_PROFILE_STORAGE_KEY = "frcenter.selectedProfile";
const chatKeyCache = new Map<string, Promise<string>>();
const MESSAGE_PAGE_SIZE = 30;
const PREFETCH_MESSAGE_PAGE_SIZE = 20;

type MessageContextMenuState = {
  message: Message;
  x: number;
  y: number;
};

type ComposerAttachment = {
  id: string;
  file: File;
  kind: "file" | "voice";
  previewUrl: string | null;
  durationSeconds: number | null;
};

const LOADING_STAGES = [
  "Syncing shell visuals",
  "Restoring encrypted session",
  "Initializing network node",
  "Opening FrCenter",
];

type SectionReadyCallback = () => void;

function App({ onReady, onBootStatus }: { onReady?: () => void; onBootStatus?: (progress: number, stage: string) => void }) {
  const [session, setSession] = React.useState<Session | null>(() => loadSession());
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [pendingEmail, setPendingEmail] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [themeId, setThemeId] = React.useState<string>(() => loadStoredThemeId());
  const [authBootstrapDone, setAuthBootstrapDone] = React.useState<boolean>(() => loadSession() !== null);
  const [backendConfigVersion, setBackendConfigVersion] = React.useState(0);
  const previousSessionUserIdRef = React.useRef<string>("");
  const activeTheme = React.useMemo(() => SITE_THEMES.find((theme) => theme.id === themeId) ?? SITE_THEMES[0], [themeId]);

  React.useEffect(() => {
    applyTheme(activeTheme);
    persistThemeId(activeTheme.id);
  }, [activeTheme]);

  React.useEffect(() => subscribeBackendUrl(() => setBackendConfigVersion((value) => value + 1)), []);

  async function handleAuthenticated(_token: string) {
    const user = await getMe(_token);
    const nextSession = { token: _token, user };
    saveSession(nextSession);
    setSession(nextSession);
    setAuthBootstrapDone(true);
  }

  function handleLogout() {
    void logout()
      .catch(() => {
        // Ignore logout transport failures and still close the local shell.
      })
      .finally(() => {
        void resetCryptoWorkerSession();
        void clearDecodedMessagesCache();
        void clearRecentMessagesInTauri();
        clearSession();
        setSession(null);
        setAuthBootstrapDone(true);
      });
  }

  React.useEffect(() => {
    const currentUserId = session?.user.id ?? "";
    if (!currentUserId) {
      previousSessionUserIdRef.current = "";
      return;
    }
    if (previousSessionUserIdRef.current && previousSessionUserIdRef.current !== currentUserId) {
      void resetCryptoWorkerSession();
      void clearDecodedMessagesCache();
    }
    previousSessionUserIdRef.current = currentUserId;
  }, [session?.user.id]);

  React.useEffect(() => {
    if (!session) {
      return;
    }
    const runMaintenance = () => {
      void pruneDecodedMessages();
    };
    if ("requestIdleCallback" in window) {
      const requestIdle = window.requestIdleCallback.bind(window);
      const cancelIdle = window.cancelIdleCallback.bind(window);
      const idleId = requestIdle(runMaintenance, { timeout: 1500 });
      return () => cancelIdle(idleId);
    }
    const timeoutId = setTimeout(runMaintenance, 300);
    return () => clearTimeout(timeoutId);
  }, [session?.user.id]);

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
      .catch((error) => {
        if (active && isUnauthorizedError(error)) {
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
    void getMe(session.token || undefined)
      .then((user) => {
        if (!active) {
          return;
        }
        const nextSession = { token: session.token, user };
        saveSession(nextSession);
        setSession(nextSession);
      })
      .catch((error) => {
        if (active && isUnauthorizedError(error)) {
          handleLogout();
        }
      });
    return () => {
      active = false;
    };
  }, [session?.token]);

  React.useEffect(() => {
    if (!session && authBootstrapDone) {
      onReady?.();
    }
  }, [authBootstrapDone, onReady, session]);

  if (!session && !authBootstrapDone) {
    return (
      <DesktopWindowFrame>
        <AuthShell>
          <p className="form-status">Проверяем сессию...</p>
        </AuthShell>
      </DesktopWindowFrame>
    );
  }

  if (!session) {
    return (
      <DesktopWindowFrame>
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
      </DesktopWindowFrame>
    );
  }

  return (
    <DesktopWindowFrame>
      <Dashboard
        backendConfigVersion={backendConfigVersion}
        onBootstrapStatus={onBootStatus}
        onBootstrapReady={onReady}
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
    </DesktopWindowFrame>
  );
}

function BootstrapApp() {
  const [appReady, setAppReady] = React.useState(false);
  const [overlayVisible, setOverlayVisible] = React.useState(true);
  const [overlayClosing, setOverlayClosing] = React.useState(false);
  const [targetProgress, setTargetProgress] = React.useState(10);
  const [progress, setProgress] = React.useState(10);
  const [stage, setStage] = React.useState("Restoring local cache");

  React.useEffect(() => {
    if (!overlayVisible) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setProgress((current) => {
        const target = appReady ? 100 : targetProgress;
        if (current >= target) {
          return current;
        }
        const step = appReady ? 8 : Math.max(1, (target - current) * 0.24);
        return Math.min(target, current + step);
      });
    }, 80);

    return () => window.clearInterval(intervalId);
  }, [appReady, overlayVisible, targetProgress]);

  React.useEffect(() => {
    if (!appReady || !overlayVisible) {
      return;
    }
    setStage(LOADING_STAGES[LOADING_STAGES.length - 1] ?? "Opening FrCenter");
    const completeTimer = window.setTimeout(() => {
      setProgress(100);
      setOverlayClosing(true);
      const hideTimer = window.setTimeout(() => setOverlayVisible(false), 560);
      return () => window.clearTimeout(hideTimer);
    }, 260);

    return () => window.clearTimeout(completeTimer);
  }, [appReady, overlayVisible]);

  return (
    <>
      <App
        onBootStatus={(nextProgress, nextStage) => {
          setTargetProgress(Math.max(10, Math.min(96, nextProgress)));
          setStage(nextStage);
        }}
        onReady={() => setAppReady(true)}
      />
      {overlayVisible ? (
        <LoadingScreen
          closing={overlayClosing}
          progress={progress}
          stage={stage}
        />
      ) : null}
    </>
  );
}

function LoadingScreen({
  closing,
  progress,
  stage,
}: {
  closing: boolean;
  progress: number;
  stage: string;
}) {
  const progressValue = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div aria-hidden="true" className={`boot-overlay ${closing ? "is-closing" : ""}`}>
      <div className="boot-scene">
        <img alt="" className="boot-scene-background" draggable="false" src={frcenterLoaderReference} />
        <div className="boot-shell-card">
          <div className="boot-art-frame">
            <img alt="FrCenter loading art" className="boot-reference-art" draggable="false" src={frcenterLoaderReference} />
          </div>
          <div className="boot-progress-panel">
            <div className="boot-progress-header">
              <span>Loading</span>
              <strong>{progressValue}%</strong>
            </div>
            <div className="boot-progress-track">
              <div className="boot-progress-fill" style={{ width: `${progressValue}%` }} />
            </div>
            <p>{stage}</p>
          </div>
        </div>
      </div>
    </div>
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

function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
  const desktop = useIsTauriDesktop();

  if (!desktop) {
    return <>{children}</>;
  }

  return (
    <div className="desktop-frame">
      <div className="desktop-window">
        <DesktopTitlebar />
        <div className="desktop-body">{children}</div>
      </div>
    </div>
  );
}

function DesktopTitlebar() {
  async function handleWindowAction(command: "minimize_window" | "toggle_maximize_window" | "close_window") {
    await invokeTauriCommand(command);
  }

  return (
    <header className="desktop-titlebar" data-tauri-drag-region onDoubleClick={() => void handleWindowAction("toggle_maximize_window")}>
      <div className="desktop-titlebar-brand" data-tauri-drag-region>
        <span className="desktop-titlebar-mark" aria-hidden="true">
          <img alt="" draggable="false" src={frcenterIcon} />
        </span>
        <div className="desktop-titlebar-copy" data-tauri-drag-region>
          <strong>FrCenter</strong>
          <span>Desktop client</span>
        </div>
      </div>
      <div className="desktop-window-controls">
        <button aria-label="Свернуть окно" className="desktop-window-button" onClick={() => void handleWindowAction("minimize_window")} type="button">
          <Minus size={16} />
        </button>
        <button
          aria-label="Развернуть или восстановить окно"
          className="desktop-window-button"
          onClick={() => void handleWindowAction("toggle_maximize_window")}
          type="button"
        >
          <Square size={14} />
        </button>
        <button aria-label="Закрыть окно" className="desktop-window-button danger" onClick={() => void handleWindowAction("close_window")} type="button">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

function BackendEndpointCard({
  className = "",
}: {
  className?: string;
}) {
  const defaultBackendUrl = React.useMemo(() => getDefaultBackendHttpUrl(), []);

  return (
    <section className={`backend-url-card ${className}`.trim()}>
      <div className="settings-card-head backend-url-card-head">
        <div className="settings-card-icon">
          <Settings size={18} />
        </div>
        <div>
          <h3>Backend endpoint</h3>
          <p>Desktop и web используют фиксированный production backend без ручной настройки при первом запуске.</p>
        </div>
      </div>
      <div className="backend-url-fixed">
        <strong>{defaultBackendUrl}</strong>
        <span>Адрес встроен в клиент и применяется автоматически.</span>
      </div>
    </section>
  );
}

function LoginForm({
  onLogin,
  onSwitch,
}: {
  onLogin: (token: string) => Promise<void>;
  onSwitch: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Входим...");
    try {
      const response = await login(email, password);
      await onLogin(response.access_token);
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
  backendConfigVersion,
  onBootstrapStatus,
  onBootstrapReady,
  session,
  onLogout,
  onSessionUserUpdate,
  themeId,
  onThemeChange,
}: {
  backendConfigVersion: number;
  onBootstrapStatus?: (progress: number, stage: string) => void;
  onBootstrapReady?: () => void;
  session: Session;
  onLogout: () => void;
  onSessionUserUpdate: (user: CurrentUser) => void;
  themeId: string;
  onThemeChange: (themeId: string) => void;
}) {
  const [friends, setFriends] = React.useState<UserPublic[]>(() => readCachedFriends(session.user.id));
  const [section, setSection] = React.useState<DashboardSection>(() => loadStoredDashboardSection());
  const [selectedProfile, setSelectedProfile] = React.useState<UserPublic | CurrentUser | null>(() => loadStoredSelectedProfile());
  const [mountedSections, setMountedSections] = React.useState<DashboardSection[]>(() =>
    Array.from(new Set<DashboardSection>([loadStoredDashboardSection(), BOOTSTRAP_SECTION_SEQUENCE[0]])),
  );
  const [bootstrapStepIndex, setBootstrapStepIndex] = React.useState(0);
  const [postBootFeaturesEnabled, setPostBootFeaturesEnabled] = React.useState(false);
  const [readySections, setReadySections] = React.useState<Partial<Record<DashboardSection, boolean>>>({
    profile: true,
    clips: true,
    settings: true,
  });
  const bootstrapReadySentRef = React.useRef(false);
  const {
    notificationsOpen,
    setNotificationsOpen,
    notifications,
    visibleNotifications,
    unreadNotifications,
    friendRequests,
    openNotifications,
    acceptIncomingFriendRequest,
    declineIncomingFriendRequest,
    readNotification,
  } = useNotificationsStore({
    backendConfigVersion,
    enabled: postBootFeaturesEnabled,
    token: session.token,
    currentUser: session.user,
    onFriendsChanged: setFriends,
  });

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

  React.useEffect(() => {
    const activeBootstrapSection = BOOTSTRAP_SECTION_SEQUENCE[bootstrapStepIndex];
    if (!activeBootstrapSection) {
      return;
    }
    setMountedSections((current) => (current.includes(activeBootstrapSection) ? current : [...current, activeBootstrapSection]));
  }, [bootstrapStepIndex]);

  const markSectionReady = React.useCallback((targetSection: DashboardSection) => {
    const bootstrapIndex = BOOTSTRAP_SECTION_SEQUENCE.indexOf(targetSection);
    setReadySections((current) => (current[targetSection] ? current : { ...current, [targetSection]: true }));
    if (bootstrapIndex >= 0) {
      setBootstrapStepIndex((current) => (current === bootstrapIndex ? Math.min(current + 1, BOOTSTRAP_SECTION_SEQUENCE.length) : current));
    }
  }, []);

  React.useEffect(() => {
    if (section === "profile" || section === "clips" || section === "settings") {
      markSectionReady(section);
    }
  }, [markSectionReady, section]);

  React.useEffect(() => {
    const completedSections = REQUIRED_BOOTSTRAP_SECTIONS.filter((targetSection) => readySections[targetSection]).length;
    const progress = completedSections === 0 ? 18 : 18 + completedSections * 24;
    const activeBootstrapSection =
      BOOTSTRAP_SECTION_SEQUENCE.find((targetSection) => !readySections[targetSection]) ??
      LOADING_STAGES[LOADING_STAGES.length - 1];
    const stageLabel =
      typeof activeBootstrapSection === "string" && isDashboardSection(activeBootstrapSection)
        ? BOOT_STAGE_BY_SECTION[activeBootstrapSection]
        : "Opening FrCenter";
    onBootstrapStatus?.(progress, stageLabel);
  }, [onBootstrapStatus, readySections]);

  React.useEffect(() => {
    if (bootstrapReadySentRef.current) {
      return;
    }
    if (!REQUIRED_BOOTSTRAP_SECTIONS.every((targetSection) => readySections[targetSection])) {
      return;
    }
    bootstrapReadySentRef.current = true;
    setPostBootFeaturesEnabled(true);
    onBootstrapStatus?.(96, "Opening FrCenter");
    onBootstrapReady?.();
  }, [onBootstrapReady, onBootstrapStatus, readySections]);

  React.useEffect(() => {
    writeCachedFriends(session.user.id, friends);
  }, [friends, session.user.id]);

  function openOwnProfile() {
    setSelectedProfile(null);
    setSection("profile");
  }

  function openUserProfile(user: UserPublic | CurrentUser) {
    if (user.id === session.user.id) {
      setSelectedProfile(null);
      setSection("profile");
      return;
    }
    setSelectedProfile(toStoredPublicUser(user));
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

      <section className={`content ${section === "chats" ? "is-chat-section" : ""}`.trim()}>
        {mountedSections.includes("profile") ? (
        <div style={{ display: section === "profile" ? "block" : "none" }}>
          <ProfilePanel
            onOpenProfile={openUserProfile}
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
          <HomePanel
            bootstrapEnabled={bootstrapStepIndex >= BOOTSTRAP_SECTION_SEQUENCE.indexOf("home")}
            cacheKey={session.user.id}
            onInitialReady={() => markSectionReady("home")}
            onOpenProfile={openUserProfile}
            token={session.token}
          />
        </div>
        ) : null}
        {mountedSections.includes("chats") ? (
        <div className="section-shell section-shell-chat" style={{ display: section === "chats" ? "flex" : "none" }}>
          <ChatsPanel
            backendConfigVersion={backendConfigVersion}
            bootstrapEnabled={bootstrapStepIndex >= BOOTSTRAP_SECTION_SEQUENCE.indexOf("chats")}
            friends={friends}
            isActive={section === "chats"}
            me={session.user}
            onInitialReady={() => markSectionReady("chats")}
            onOpenProfile={openUserProfile}
            token={session.token}
          />
        </div>
        ) : null}
        {mountedSections.includes("friends") ? (
        <div style={{ display: section === "friends" ? "block" : "none" }}>
          <FriendsPanel
            bootstrapEnabled={bootstrapStepIndex >= BOOTSTRAP_SECTION_SEQUENCE.indexOf("friends")}
            initialFriends={friends}
            onInitialReady={() => markSectionReady("friends")}
            token={session.token}
            onFriendsChanged={setFriends}
            onOpenProfile={openUserProfile}
          />
        </div>
        ) : null}
        {mountedSections.includes("games") ? (
        <div style={{ display: section === "games" ? "block" : "none" }}>
          <GamesPanel friends={friends} onInitialReady={() => markSectionReady("games")} onOpenProfile={openUserProfile} onSessionUserUpdate={onSessionUserUpdate} token={session.token} />
        </div>
        ) : null}
        {mountedSections.includes("clips") ? (
        <div style={{ display: section === "clips" ? "block" : "none" }}>
          <ClipsPanel friends={friends} onOpenProfile={openUserProfile} />
        </div>
        ) : null}
        {mountedSections.includes("settings") ? (
        <div style={{ display: section === "settings" ? "block" : "none" }}>
          <SettingsPanel
            backendConfigVersion={backendConfigVersion}
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
        <button aria-label="Уведомления" className="friends-notifications-dock" onClick={() => void openNotifications()} type="button">
          <Bell size={18} />
          {unreadNotifications > 0 ? <span className="friends-notifications-badge">{unreadNotifications}</span> : null}
        </button>
        {friends.map((friend) => (
          <button className="friend" key={friend.id} onClick={() => openUserProfile(friend)} type="button">
            <div>
              {friend.avatar_url ? <img alt={friend.username} src={friend.avatar_url} /> : friend.username.slice(0, 1).toUpperCase()}
            </div>
            <span className="username-link-label">{friend.username}</span>
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
                  <p>
                    <button className="username-link inline-username-link" onClick={() => openUserProfile(request.from_user)} type="button">
                      @{request.from_user.username}
                    </button>{" "}
                    хочет добавить вас в друзья.
                  </p>
                  <div className="notification-card-actions">
                    <button onClick={() => void acceptIncomingFriendRequest(request.id)} type="button">
                      Принять
                    </button>
                    <button className="secondary" onClick={() => void declineIncomingFriendRequest(request.id)} type="button">
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
                    <button className="notification-read-button" onClick={() => void readNotification(notification.id)} type="button">
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
  onOpenProfile,
  onLogout,
  token,
  profile,
  sessionUser,
  onSessionUserUpdate,
}: {
  onOpenProfile: (user: UserPublic | CurrentUser) => void;
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
    category: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    errorText: string,
  ) {
    if (!file) {
      setter("");
      return;
    }
    try {
      setStatusText("Загружаем изображение...");
      setter(await uploadPublicVisualAsset(token, file, category));
      setStatusText("");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : errorText);
    }
  }

  async function handlePublishImage(file: File | null) {
    if (!file) {
      setPublishImageUrl("");
      return;
    }
    try {
      setStatusText("Загружаем фото публикации...");
      setPublishImageUrl(await uploadPublicVisualAsset(token, file, "profile-photo"));
      setStatusText("");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Не удалось загрузить фото публикации");
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
                    <button className="username-link profile-main-tag profile-main-tag-button" onClick={() => onOpenProfile(profile)} type="button">
                      @{cardUsername}
                    </button>
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
                onChange={(event) =>
                  void handleSingleImagePick(event.target.files?.[0] ?? null, "profile-avatar", setAvatarUrl, "Не удалось загрузить аватар")
                }
                ref={avatarInputRef}
                type="file"
              />
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) =>
                  void handleSingleImagePick(event.target.files?.[0] ?? null, "profile-banner", setBannerUrl, "Не удалось загрузить баннер")
                }
                ref={bannerInputRef}
                type="file"
              />
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) =>
                  void handleSingleImagePick(
                    event.target.files?.[0] ?? null,
                    "profile-background",
                    setBackgroundUrl,
                    "Не удалось загрузить фон",
                  )
                }
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

function HomePanel({
  token,
  cacheKey,
  bootstrapEnabled,
  onInitialReady,
  onOpenProfile,
}: {
  token: string;
  cacheKey: string;
  bootstrapEnabled: boolean;
  onInitialReady?: SectionReadyCallback;
  onOpenProfile: (user: UserPublic) => void;
}) {
  const [items, setItems] = React.useState<FeedPublication[]>(() => readCachedFeed(cacheKey));
  const [status, setStatus] = React.useState("");
  const initialReadyRef = React.useRef(false);

  React.useEffect(() => {
    if (!bootstrapEnabled) {
      return;
    }
    let active = true;
    setStatus(items.length > 0 ? "Обновляем публикации..." : "Загружаем публикации...");
    void listFeed(token)
      .then((response) => {
        if (!active) {
          return;
        }
        setItems(response);
        writeCachedFeed(cacheKey, response);
        setStatus(response.length === 0 ? "Публикаций пока нет" : "");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setStatus(error instanceof Error ? error.message : "Не удалось загрузить публикации");
      })
      .finally(() => {
        if (!active || initialReadyRef.current) {
          return;
        }
        initialReadyRef.current = true;
        onInitialReady?.();
      });
    return () => {
      active = false;
    };
  }, [bootstrapEnabled, cacheKey, onInitialReady, token]);

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
                    <button
                      className="username-link feed-username-link"
                      onClick={() =>
                        onOpenProfile({
                          id: item.author_id,
                          username: item.author_username,
                          display_name: item.author_display_name,
                          nickname: null,
                          profile_status: null,
                          profile_banner_url: null,
                          profile_background_url: null,
                          profile_photos: null,
                          avatar_ring_style: null,
                          avatar_url: item.author_avatar_url,
                          status: "offline",
                          current_game: null,
                        })
                      }
                      type="button"
                    >
                      @{item.author_username}
                    </button>
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

function GamesPanel({
  token,
  friends,
  onInitialReady,
  onOpenProfile,
  onSessionUserUpdate,
}: {
  token: string;
  friends: UserPublic[];
  onInitialReady?: SectionReadyCallback;
  onOpenProfile: (user: UserPublic) => void;
  onSessionUserUpdate: (user: CurrentUser) => void;
}) {
  const [steam, setSteam] = React.useState<SteamOverview | null>(null);
  const [status, setStatus] = React.useState("");
  const initialReadyRef = React.useRef(false);

  React.useEffect(() => {
    void loadOverview();
  }, [token]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const gamesStatus = params.get("games");
    const gamesMessage = params.get("games_message");
    if (!gamesStatus) {
      return;
    }
    const mappedStatus =
      gamesStatus === "steam_connected"
        ? "Steam подключен"
        : gamesMessage || "Не удалось завершить подключение";
    setStatus(mappedStatus);
    params.delete("games");
    params.delete("games_message");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
    void Promise.all([loadOverview(), refreshCurrentUser()]);
  }, [token]);

  async function loadOverview() {
    try {
      const overview = await getGamesOverview(token);
      setSteam(overview.steam);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить игровые интеграции");
    } finally {
      if (!initialReadyRef.current) {
        initialReadyRef.current = true;
        onInitialReady?.();
      }
    }
  }

  async function refreshCurrentUser() {
    const updated = await getMe(token);
    onSessionUserUpdate(updated);
  }

  function handleConnect(provider: SteamOverview | null, title: string) {
    if (!provider?.enabled || !provider.connect_url) {
      setStatus(provider?.status_hint || `${title} пока не настроен на backend`);
      return;
    }
    window.location.href = provider.connect_url;
  }

  async function handleDisconnect(title: string) {
    setStatus(`Отключаем ${title}...`);
    try {
      await disconnectGameAccount(token, "steam");
      await Promise.all([loadOverview(), refreshCurrentUser()]);
      setStatus(`${title} отключен`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось отключить интеграцию");
    }
  }

  return (
    <section className="tool-band games-panel">
      <div className="games-main-card">
        <div className="panel-hero panel-hero-games">
          <span>Game sync</span>
          <h2>Игровые интеграции</h2>
          <p>Подключай Steam, чтобы держать игровой профиль и текущий статус в одном месте.</p>
        </div>

        <div className="games-platform-grid">
          <GameIntegrationCard
            provider={steam}
            onConnect={() => handleConnect(steam, "Steam")}
            onDisconnect={() => void handleDisconnect("Steam")}
          />
        </div>
      </div>

      <div className="games-side-column">
        <section className="friends-side-section">
          <div className="friends-card-head">
            <div className="friends-card-icon">
              <Gamepad2 size={18} />
            </div>
            <div>
              <h3>Активность друзей</h3>
              <p>Список строится по общему `current_game`, поэтому Steam-статус сразу виден в профилях и друзьях.</p>
            </div>
          </div>
          <div className="result-list">
            {friends.map((friend) => (
              <div className="result-row" key={friend.id}>
                <button className="username-link result-username-link" onClick={() => onOpenProfile(friend)} type="button">
                  {friend.username}
                </button>
                <span>{friend.current_game ?? "Не играет"}</span>
              </div>
            ))}
            {friends.length === 0 ? <div className="friends-empty-state">Сначала добавь друзей, чтобы видеть их игровые статусы.</div> : null}
          </div>
        </section>
        <p className={`form-status friends-status ${status ? "visible" : ""}`}>{status || " "}</p>
      </div>
    </section>
  );
}

function GameIntegrationCard({
  provider,
  onConnect,
  onDisconnect,
}: {
  provider: SteamOverview | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const title = "Steam";
  const account = provider?.account ?? null;
  const steamStats = provider?.steam_stats ?? null;
  const isEnabled = provider?.enabled ?? false;
  const statusHint = provider?.status_hint ?? "";

  return (
    <section className="games-platform-card">
      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Gamepad2 size={18} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>Подключение идет через Steam OpenID, затем мы подтягиваем профиль и недавно сыгранные игры.</p>
        </div>
      </div>
      <div className="settings-toggle-list">
        <div className="settings-toggle-row">
          <div>
            <strong>Статус подключения</strong>
            <span>{account ? "Аккаунт подключен" : isEnabled ? "Можно подключать" : statusHint || "Провайдер отключен"}</span>
          </div>
          <span>{account ? "online" : "idle"}</span>
        </div>
        <div className="games-card-actions">
          <button className="inline-action" onClick={onConnect} type="button">
            {account ? `Переподключить ${title}` : `Подключить ${title}`}
          </button>
          {account ? (
            <button className="inline-action secondary" onClick={onDisconnect} type="button">
              Отключить
            </button>
          ) : null}
        </div>
        {account ? (
          <div className="games-provider-summary">
            <div className="games-summary-row">
              <strong>Аккаунт</strong>
              <span>{account.display_name || account.external_user_id}</span>
            </div>
            {steamStats ? (
              <>
                <div className="games-summary-row">
                  <strong>Сейчас играет</strong>
                  <span>{steamStats.current_game || "Не в игре"}</span>
                </div>
                <div className="games-summary-row">
                  <strong>Профиль</strong>
                  <span>{steamStats.persona_name || "Steam profile"}</span>
                </div>
                <div className="games-stats-list">
                  {steamStats.recent_games.map((game) => (
                    <div className="games-stat-chip" key={`${game.app_id}-${game.name}`}>
                      <strong>{game.name}</strong>
                      <span>{game.playtime_hours} ч</span>
                    </div>
                  ))}
                  {steamStats.recent_games.length === 0 ? <div className="friends-empty-state">Недавно сыгранных Steam-игр пока нет.</div> : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ClipsPanel({ friends, onOpenProfile }: { friends: UserPublic[]; onOpenProfile: (user: UserPublic) => void }) {
  return (
    <section className="tool-band single-column">
      <div>
        <h2>Клипы</h2>
        <p className="form-status">Медиа-посты друзей (видео/фото) будут отображаться здесь.</p>
        <div className="result-list">
          {friends.slice(0, 6).map((friend) => (
            <div className="result-row" key={friend.id}>
              <button className="username-link result-username-link" onClick={() => onOpenProfile(friend)} type="button">
                {friend.username}
              </button>
              <span>Публикаций: 0</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPanel({
  backendConfigVersion,
  token,
  user,
  onSessionUserUpdate,
  themeId,
  onThemeChange,
}: {
  backendConfigVersion: number;
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
  const [notificationSoundName, setNotificationSoundName] = React.useState(() => getNotificationSoundName(user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL));
  const [notificationVolume, setNotificationVolume] = React.useState(Math.round((user.notification_volume ?? 0.7) * 100));
  const [notificationSoundDragActive, setNotificationSoundDragActive] = React.useState(false);
  const [notificationSoundUploading, setNotificationSoundUploading] = React.useState(false);
  const [settingsStatus, setSettingsStatus] = React.useState("");
  const notificationSoundInputRef = React.useRef<HTMLInputElement | null>(null);
  const notificationPreviewAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const notificationSoundDisplayName = notificationSoundName || getNotificationSoundName(notificationSoundUrl);

  React.useEffect(() => {
    setNotificationSoundUrl(user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL);
    setNotificationSoundName(getNotificationSoundName(user.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL));
    setNotificationVolume(Math.round((user.notification_volume ?? 0.7) * 100));
  }, [user.notification_sound_url, user.notification_volume]);

  React.useEffect(() => {
    if (!notificationPreviewAudioRef.current) {
      return;
    }
    notificationPreviewAudioRef.current.volume = Math.max(0, Math.min(1, notificationVolume / 100));
  }, [notificationVolume]);

  async function handleNotificationSoundUpload(file: File) {
    const looksLikeAudio = file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
    if (!looksLikeAudio) {
      setSettingsStatus("Можно загрузить только аудиофайл для звука уведомления.");
      return;
    }

    setNotificationSoundUploading(true);
    setSettingsStatus(`Загружаем ${file.name}...`);

    try {
      const uploaded = await uploadPublicMedia(token, file, "notification-sound");
      setNotificationSoundUrl(uploaded.asset_url);
      setNotificationSoundName(file.name);
      setSettingsStatus("Новый звук уведомления загружен. Не забудь сохранить настройки.");
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : "Не удалось загрузить звук уведомления");
    } finally {
      setNotificationSoundUploading(false);
      if (notificationSoundInputRef.current) {
        notificationSoundInputRef.current.value = "";
      }
    }
  }

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
          <BackendEndpointCard className="settings-panel-card" />

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
                  <span>Перетащи свой mp3, wav, ogg или выбери файл вручную.</span>
                </div>
                <div
                  className={`notification-sound-dropzone ${notificationSoundDragActive ? "is-drag-active" : ""} ${notificationSoundUploading ? "is-uploading" : ""}`}
                  onClick={() => notificationSoundInputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setNotificationSoundDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    const nextTarget = event.relatedTarget;
                    if (!nextTarget || !(event.currentTarget as HTMLDivElement).contains(nextTarget as Node)) {
                      setNotificationSoundDragActive(false);
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setNotificationSoundDragActive(true);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setNotificationSoundDragActive(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) {
                      void handleNotificationSoundUpload(file);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      notificationSoundInputRef.current?.click();
                    }
                  }}
                >
                  <input
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                    className="notification-sound-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleNotificationSoundUpload(file);
                      }
                    }}
                    ref={notificationSoundInputRef}
                    type="file"
                  />
                  <div className="notification-sound-dropzone-copy">
                    <div className="notification-sound-dropzone-icon">
                      <Paperclip size={18} />
                    </div>
                    <div>
                      <strong>{notificationSoundUploading ? "Загрузка..." : "Добавить свой звук"}</strong>
                      <span>{notificationSoundDisplayName}</span>
                    </div>
                  </div>
                  <div className="notification-sound-dropzone-actions">
                    <button
                      className="inline-action secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setNotificationSoundUrl(DEFAULT_NOTIFICATION_SOUND_URL);
                        setNotificationSoundName(getNotificationSoundName(DEFAULT_NOTIFICATION_SOUND_URL));
                        setSettingsStatus("Возвращен стандартный звук. Нажми сохранить, чтобы применить.");
                      }}
                      type="button"
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
                <div className="notification-sound-preview-card">
                  <div className="notification-sound-preview-meta">
                    <div className="notification-sound-preview-icon">
                      <Bell size={16} />
                    </div>
                    <div>
                      <strong>{notificationSoundDisplayName}</strong>
                      <span className="notification-sound-url">{notificationSoundUrl}</span>
                    </div>
                  </div>
                  <audio
                    className="notification-sound-preview"
                    controls
                    preload="metadata"
                    ref={notificationPreviewAudioRef}
                    src={notificationSoundUrl}
                  />
                </div>
              </label>
              <label className="settings-toggle-row settings-input-row volume-control-row">
                <div className="volume-control-copy">
                  <strong>Громкость</strong>
                  <span>{notificationVolume}%</span>
                </div>
                <div className="volume-control-shell">
                  <input
                    className="notification-volume-slider"
                    max={100}
                    min={0}
                    onChange={(event) => setNotificationVolume(Number(event.target.value))}
                    type="range"
                    value={notificationVolume}
                  />
                </div>
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
                    {theme.swatches.map((swatch) => (
                      <span key={`${theme.id}-${swatch}`} style={{ backgroundColor: swatch }} />
                    ))}
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

function getNotificationSoundName(url: string): string {
  if (!url) {
    return "Стандартный звук FrCenter";
  }
  try {
    const fileName = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!fileName) {
      return "Пользовательский звук";
    }
    return decodeURIComponent(fileName);
  } catch {
    return url;
  }
}

function readCachedFeed(userId: string): FeedPublication[] {
  return readStoredJson<FeedPublication[]>(`${FEED_CACHE_STORAGE_KEY_PREFIX}${userId}`, []);
}

function writeCachedFeed(userId: string, items: FeedPublication[]): void {
  writeStoredJson(`${FEED_CACHE_STORAGE_KEY_PREFIX}${userId}`, items.slice(0, 60));
}

function readCachedFriends(userId: string): UserPublic[] {
  return readStoredJson<UserPublic[]>(`${FRIENDS_CACHE_STORAGE_KEY_PREFIX}${userId}`, []);
}

function writeCachedFriends(userId: string, items: UserPublic[]): void {
  writeStoredJson(`${FRIENDS_CACHE_STORAGE_KEY_PREFIX}${userId}`, items);
}

function FriendsPanel({
  bootstrapEnabled,
  initialFriends,
  onInitialReady,
  token,
  onFriendsChanged,
  onOpenProfile,
}: {
  bootstrapEnabled: boolean;
  initialFriends: UserPublic[];
  onInitialReady?: SectionReadyCallback;
  token: string;
  onFriendsChanged: (friends: UserPublic[]) => void;
  onOpenProfile: (friend: UserPublic) => void;
}) {
  const [friends, setFriends] = React.useState<UserPublic[]>(initialFriends);
  const [inviteCode, setInviteCode] = React.useState("");
  const [joinCode, setJoinCode] = React.useState("");
  const [status, setStatus] = React.useState("");
  const initialReadyRef = React.useRef(false);
  const onlineFriends = React.useMemo(
    () => friends.filter((friend) => normalizeStatus(friend.status) === "online").length,
    [friends],
  );

  React.useEffect(() => {
    setFriends(initialFriends);
  }, [initialFriends]);

  React.useEffect(() => {
    if (!bootstrapEnabled) {
      return;
    }
    void refreshFriends();
    void loadPersonalInviteCode();
  }, [bootstrapEnabled, token]);

  async function refreshFriends() {
    try {
      const response = await listFriends(token);
      setFriends(response.friends);
      onFriendsChanged(response.friends);
    } finally {
      if (!initialReadyRef.current) {
        initialReadyRef.current = true;
        onInitialReady?.();
      }
    }
  }

  async function loadPersonalInviteCode() {
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

        <div className="friends-grid">
          {friends.map((friend) => (
            <article className="friend-card" key={friend.id}>
              <div className="friend-card-head">
                <div className="friend-card-avatar">
                  {friend.avatar_url ? <img alt={friend.username} src={friend.avatar_url} /> : friend.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="friend-card-meta">
                  <button className="username-link card-username-link" onClick={() => onOpenProfile(friend)} type="button">
                    {friend.display_name || friend.username}
                  </button>
                  <button className="username-link card-username-link secondary" onClick={() => onOpenProfile(friend)} type="button">
                    @{friend.username}
                  </button>
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
        <section className="friends-side-section friends-invite-card">
          <div className="friends-card-head">
            <div className="friends-card-icon">
              <Copy size={18} />
            </div>
            <div>
              <h3>Invite-код</h3>
              <p>У тебя один персональный код. Им можно делиться сколько угодно, кнопка генерации больше не нужна.</p>
            </div>
          </div>
          <div className="invite-code-box">{inviteCode || "Код еще не создан"}</div>
          <div className="friends-action-row">
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
  backendConfigVersion,
  bootstrapEnabled,
  isActive,
  token,
  me,
  friends,
  onInitialReady,
  onOpenProfile,
}: {
  backendConfigVersion: number;
  bootstrapEnabled: boolean;
  isActive: boolean;
  token: string;
  me: CurrentUser;
  friends: UserPublic[];
  onInitialReady?: SectionReadyCallback;
  onOpenProfile: (user: UserPublic) => void;
}) {
  const [chats, setChats] = React.useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = React.useState<string>(() => readStoredSelectedChatId(me.id));
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [messageText, setMessageText] = React.useState("");
  const [composerAttachments, setComposerAttachments] = React.useState<ComposerAttachment[]>([]);
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
  const [isRecordingVoice, setIsRecordingVoice] = React.useState(false);
  const [chatsLoading, setChatsLoading] = React.useState(true);
  const [chatCacheHydrated, setChatCacheHydrated] = React.useState(false);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = React.useState(false);
  const [messagesHasMore, setMessagesHasMore] = React.useState(false);
  const [isMessageListAtBottom, setIsMessageListAtBottom] = React.useState(true);
  const [messagesOffset, setMessagesOffset] = React.useState<number | null>(null);
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 820px)").matches;
  });
  const [mobileChatOpen, setMobileChatOpen] = React.useState(false);
  const initialReadyRef = React.useRef(false);

  const createParticipantsDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const editAvatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const editBackgroundInputRef = React.useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const voiceStreamRef = React.useRef<MediaStream | null>(null);
  const voiceChunksRef = React.useRef<Blob[]>([]);
  const composerAttachmentsRef = React.useRef<ComposerAttachment[]>([]);
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const selectedChatIdRef = React.useRef<string>("");
  const previousChatCleanupRef = React.useRef<string>(selectedChatId);
    const messageRequestRef = React.useRef(0);
    const olderMessagesRequestRef = React.useRef(0);
    const skipNextAutoScrollRef = React.useRef(false);
    const isMessageListAtBottomRef = React.useRef(true);
  const decodedMessagesCacheRef = React.useRef<Record<string, Record<string, string>>>({});
  const chatMessagesCacheRef = React.useRef<Record<string, Message[]>>({});
  const chatMessagePageInfoRef = React.useRef<Record<string, { nextOffset: number | null; hasMore: boolean }>>({});
  const chatPrefetchInFlightRef = React.useRef<Record<string, boolean>>({});

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
  const selectedDirectPeer = React.useMemo(
    () =>
      selectedChat?.type === "direct"
        ? selectedChat.peer ?? selectedChat.members?.find((member) => member.user.id !== me.id)?.user ?? null
        : null,
    [me.id, selectedChat],
  );
  const myMember = selectedChat?.members?.find((member) => member.user.id === me.id) ?? null;
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

  const scrollToBottom = React.useCallback((behavior: "auto" | "smooth" = "auto") => {
      const list = virtuosoRef.current;
      if (!list || messages.length === 0) {
        return;
      }
      requestAnimationFrame(() => {
        list.scrollToIndex({ index: messages.length - 1, align: "end", behavior });
      });
    }, [messages.length]);

  React.useEffect(() => {
    let active = true;
    setChatCacheHydrated(false);
    void readCachedChats(me.id)
      .then((cachedChats) => {
        if (!active) {
          return;
        }
        if (cachedChats.length > 0) {
          setChats(cachedChats);
        }
      })
      .finally(() => {
        if (active) {
          setChatCacheHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, [me.id]);

  React.useEffect(() => {
    if (!bootstrapEnabled) {
      return;
    }
    void reloadChats();
  }, [bootstrapEnabled, token]);

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
    if (previousChatCleanupRef.current && previousChatCleanupRef.current !== selectedChatId) {
      mediaRecorderRef.current?.stop();
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsRecordingVoice(false);
      clearComposerAttachments();
      setComposerDragActive(false);
    }
    previousChatCleanupRef.current = selectedChatId;
  }, [selectedChatId]);

  React.useEffect(() => {
    isMessageListAtBottomRef.current = isMessageListAtBottom;
  }, [isMessageListAtBottom]);

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
    if (!bootstrapEnabled || !isActive) {
      return;
    }
    if (!selectedChatId) {
      setMessages([]);
      setDecodeMap({});
      setMessagesLoading(false);
      setLoadingOlderMessages(false);
      setMessagesHasMore(false);
      setIsMessageListAtBottom(true);
      setMessagesOffset(null);
      return;
    }
    setIsMessageListAtBottom(true);
    void loadChatDetails(selectedChatId);
    void loadChatMessages(selectedChatId);
  }, [bootstrapEnabled, isActive, selectedChatId, token]);

  useRealtimeSubscription(
    backendConfigVersion,
    token,
    (event) => {
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
          setChats((previous) =>
            previous.map((chat) =>
              chat.id === incoming.chat_id
                ? {
                    ...chat,
                    unread_count: 0,
                    updated_at: incoming.created_at,
                    last_message_at: incoming.created_at,
                    last_message_id: incoming.id,
                  }
                : chat,
            ),
          );
        } else if (incoming.sender.id !== me.id) {
          setChats((previous) =>
            previous.map((chat) =>
              chat.id === incoming.chat_id
                ? {
                    ...chat,
                    unread_count: (chat.unread_count ?? 0) + 1,
                    updated_at: incoming.created_at,
                    last_message_at: incoming.created_at,
                    last_message_id: incoming.id,
                  }
                : chat,
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
    },
  );

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
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  React.useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      composerAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
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
    if (!chatCacheHydrated) {
      return;
    }
    void writeCachedChats(me.id, chats);
  }, [chatCacheHydrated, chats, me.id]);

  React.useEffect(() => {
    writeStoredSelectedChatId(me.id, selectedChatId);
  }, [me.id, selectedChatId]);

  React.useEffect(() => {
    if (!selectedChatId) {
      return;
    }
    void cacheRecentMessagesInTauri(selectedChatId, messages);
  }, [messages, selectedChatId]);

  React.useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (!isMessageListAtBottomRef.current) {
      return;
    }
    scrollToBottom();
  }, [messages.length, selectedChatId, scrollToBottom]);

  React.useEffect(() => {
    if (initialReadyRef.current || !bootstrapEnabled || !chatCacheHydrated || chatsLoading) {
      return;
    }
    if (orderedChats.length === 0) {
      initialReadyRef.current = true;
      onInitialReady?.();
      return;
    }
    if (!isMobile && !selectedChatId && orderedChats.length > 0) {
      return;
    }
    initialReadyRef.current = true;
    onInitialReady?.();
  }, [bootstrapEnabled, chatCacheHydrated, chatsLoading, isMobile, onInitialReady, orderedChats.length, selectedChatId]);

  async function reloadChats() {
    setChatsLoading(true);
    try {
      const response = await listChats(token);
      setChats((previous) => mergeChatSummaries(previous, response.chats));
    } finally {
      setChatsLoading(false);
    }
  }

  async function loadChatDetails(chatId: string) {
    const currentChat = chats.find((chat) => chat.id === chatId);
    if (currentChat?.members && currentChat.members.length > 0) {
      return;
    }
    try {
      const detailedChat = await readChat(token, chatId);
      setChats((previous) => previous.map((chat) => (chat.id === chatId ? { ...chat, ...detailedChat } : chat)));
    } catch {
      // keep summary chat usable even if detail fetch fails
    }
  }

  function bumpChatActivity(chatId: string, updatedAt: string) {
    setChats((previous) =>
      previous.map((chat) =>
        chat.id === chatId
          ? { ...chat, updated_at: updatedAt, last_message_at: updatedAt }
          : chat,
      ),
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

  function getCacheSalt(chatId: string): string {
    return `frcenter-cache:${me.id}:${chatId}`;
  }

  async function decodeMessagesForChat(chatId: string, items: Message[]): Promise<Record<string, string>> {
    const existing = decodedMessagesCacheRef.current[chatId] ?? {};
    const nextDecoded: Record<string, string> = { ...existing };
    const pendingItems = items.filter((message) => nextDecoded[message.id] === undefined);
    if (pendingItems.length > 0) {
      const key = await ensureChatKey(chatId);
      const cacheSalt = getCacheSalt(chatId);
      const cachedEntries = await getCachedDecodedMessages(
        chatId,
        pendingItems.map((message) => message.id),
      );
      if (cachedEntries.length > 0) {
        const decryptedCache = await decryptCacheEntriesInWorker(
          key,
          cacheSalt,
          cachedEntries.map((item) => ({
            id: item.messageId,
            ciphertext: item.ciphertext,
            iv: item.iv,
          })),
        );
        for (const item of decryptedCache) {
          nextDecoded[item.id] = item.plaintext;
        }
      }
      const remainingItems = pendingItems.filter((message) => nextDecoded[message.id] === undefined);
      if (remainingItems.length > 0) {
        const decryptedMessages = await decryptMessagesInWorker(
          key,
          remainingItems.map((message) => ({
            id: message.id,
            ciphertext: message.ciphertext,
            nonce: message.nonce,
          })),
        );
        for (const item of decryptedMessages) {
          nextDecoded[item.id] = item.plaintext;
        }
        const encryptedCacheItems = await encryptCacheEntriesInWorker(
          key,
          cacheSalt,
          decryptedMessages.map((item) => ({
            id: item.id,
            plaintext: item.plaintext,
          })),
        );
        await upsertCachedDecodedMessages(
          encryptedCacheItems.map((item) => ({
            chatId,
            messageId: item.id,
            ciphertext: item.ciphertext,
            iv: item.iv,
            updatedAt: new Date().toISOString(),
          })),
        );
      }
    }
    decodedMessagesCacheRef.current[chatId] = nextDecoded;
    return nextDecoded;
  }

  async function hydrateMessagesFromTauriCache(chatId: string, requestId: number): Promise<void> {
    const cachedJson = await loadRecentMessagesFromTauri(chatId);
    if (!cachedJson || messageRequestRef.current !== requestId || selectedChatIdRef.current !== chatId) {
      return;
    }

    const cachedMessages = dedupeMessagesById(await parseJsonTextInWorker<Message[]>(cachedJson));
    if (cachedMessages.length === 0) {
      return;
    }

    chatMessagesCacheRef.current[chatId] = cachedMessages;
    setMessages(cachedMessages);
    setDecodeMap(decodedMessagesCacheRef.current[chatId] ?? {});
  }

  async function loadChatMessages(chatId: string) {
    const requestId = messageRequestRef.current + 1;
    messageRequestRef.current = requestId;

    const cachedMessages = chatMessagesCacheRef.current[chatId];
    const cachedDecoded = decodedMessagesCacheRef.current[chatId];
    const cachedPageInfo = chatMessagePageInfoRef.current[chatId];
    if (cachedMessages) {
      setMessages(cachedMessages);
      setDecodeMap(cachedDecoded ?? {});
      setMessagesHasMore(cachedPageInfo?.hasMore ?? false);
      setMessagesOffset(cachedPageInfo?.nextOffset ?? null);
    } else {
      setMessages([]);
      setDecodeMap({});
      setMessagesLoading(true);
      void hydrateMessagesFromTauriCache(chatId, requestId);
    }

    try {
      const response = await listChatMessages(token, chatId, { limit: MESSAGE_PAGE_SIZE });
      if (messageRequestRef.current !== requestId || selectedChatIdRef.current !== chatId) {
        return;
      }
      chatMessagesCacheRef.current[chatId] = response.messages;
      chatMessagePageInfoRef.current[chatId] = {
        nextOffset: response.next_offset,
        hasMore: response.has_more,
      };
      setMessages(response.messages);
      setMessagesHasMore(response.has_more);
      setMessagesOffset(response.next_offset);
      const decoded = await decodeMessagesForChat(chatId, response.messages);
      if (messageRequestRef.current !== requestId || selectedChatIdRef.current !== chatId) {
        return;
      }
      setDecodeMap(decoded);
      await markChatAsRead(chatId);
    } catch (error) {
      if (messageRequestRef.current !== requestId || selectedChatIdRef.current !== chatId) {
        return;
      }
      chatMessagePageInfoRef.current[chatId] = {
        nextOffset: null,
        hasMore: false,
      };
      setMessagesHasMore(false);
      setMessagesOffset(null);
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить сообщения");
    } finally {
      if (messageRequestRef.current === requestId && selectedChatIdRef.current === chatId) {
        setMessagesLoading(false);
      }
    }
  }

  async function prefetchChatMessages(chatId: string) {
    if (chatMessagesCacheRef.current[chatId] || chatPrefetchInFlightRef.current[chatId]) {
      return;
    }
    chatPrefetchInFlightRef.current[chatId] = true;
    try {
      const response = await listChatMessages(token, chatId, { limit: PREFETCH_MESSAGE_PAGE_SIZE });
      chatMessagesCacheRef.current[chatId] = response.messages;
      chatMessagePageInfoRef.current[chatId] = {
        nextOffset: response.next_offset,
        hasMore: response.has_more,
      };
      await decodeMessagesForChat(chatId, response.messages);
    } catch {
      // keep prefetch silent
    } finally {
      delete chatPrefetchInFlightRef.current[chatId];
    }
  }

  async function loadOlderMessages() {
    if (!selectedChatId || loadingOlderMessages || !messagesHasMore || typeof messagesOffset !== "number") {
      return;
    }
    const requestId = olderMessagesRequestRef.current + 1;
    olderMessagesRequestRef.current = requestId;
    setLoadingOlderMessages(true);
    try {
      const response = await listChatMessages(token, selectedChatId, {
        offset: messagesOffset,
        limit: MESSAGE_PAGE_SIZE,
      });
      if (olderMessagesRequestRef.current !== requestId || selectedChatIdRef.current !== selectedChatId) {
        return;
      }
      const decoded = await decodeMessagesForChat(selectedChatId, response.messages);
      setDecodeMap((previous) => ({ ...previous, ...decoded }));
      skipNextAutoScrollRef.current = true;
      setMessages((previous) => {
        const next = dedupeMessagesById([...response.messages, ...previous]);
        chatMessagesCacheRef.current[selectedChatId] = next;
        return next;
      });
      chatMessagePageInfoRef.current[selectedChatId] = {
        nextOffset: response.next_offset,
        hasMore: response.has_more,
      };
      setMessagesHasMore(response.has_more);
      setMessagesOffset(response.next_offset);
    } finally {
      if (olderMessagesRequestRef.current === requestId) {
        setLoadingOlderMessages(false);
      }
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
      const encrypted = await encryptTextForSharedKeyInWorker(trimmed, key);
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
      const rotatedKey = await generateSharedKeyInWorker();
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
      const rotatedKey = await generateSharedKeyInWorker();
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
    const encrypted = await encryptTextForSharedKeyInWorker(text, key);
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
    const encryptedFile = await encryptBytesForSharedKeyInWorker(fileBytes, chatKey);
    const encryptedBuffer = new ArrayBuffer(encryptedFile.ciphertextBytes.byteLength);
    new Uint8Array(encryptedBuffer).set(encryptedFile.ciphertextBytes);
    const encryptedBlob = new Blob([encryptedBuffer], { type: "application/octet-stream" });
    const encryptedFileObject = new File([encryptedBlob], `${file.name}.enc`, { type: "application/octet-stream" });
    const media = await uploadEncryptedMedia(token, selectedChatId, encryptedFileObject);
    return {
      media_id: media.media_id,
      media_url: media.media_url,
      media_path: media.media_path,
      file_name: file.name,
      file_size: file.size,
      file_mime: file.type || "application/octet-stream",
      file_nonce: encryptedFile.nonce,
    };
  }

  async function handleVoiceRecordToggle() {
    if (isRecordingVoice) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!selectedChatId) {
      setStatus("Сначала выбери чат");
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("Запись голосовых не поддерживается в этом браузере");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000,
        },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, {
            audioBitsPerSecond: 128000,
            mimeType,
          })
        : new MediaRecorder(stream, {
            audioBitsPerSecond: 128000,
          });
      voiceChunksRef.current = [];
      voiceStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener(
        "stop",
        () => {
          const blobType = recorder.mimeType || "audio/webm";
          const blob = new Blob(voiceChunksRef.current, { type: blobType });
          voiceChunksRef.current = [];
          voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
          voiceStreamRef.current = null;
          mediaRecorderRef.current = null;
          setIsRecordingVoice(false);
          if (blob.size === 0) {
            setStatus("Голосовое получилось пустым");
            return;
          }
          const extension = blobType.includes("ogg") ? "ogg" : "webm";
          const voiceFile = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: blobType });
          void addFilesToComposer([voiceFile]);
          setStatus("Голосовое добавлено в сообщение");
        },
        { once: true },
      );
      recorder.start();
      setIsRecordingVoice(true);
      setStatus("Идет запись голосового...");
    } catch (error) {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsRecordingVoice(false);
      setStatus(error instanceof Error ? error.message : "Не удалось начать запись");
    }
  }

  async function handleSendComposer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChatId) {
      return;
    }

    const text = messageText.trim();
    if (!text && composerAttachments.length === 0) {
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
      if (composerAttachments.length > 0) {
        const batches = chunkArray(composerAttachments, 10);
        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          setStatus(`Шифруем и отправляем вложения ${index + 1}/${batches.length}...`);
          const uploadedFiles = await Promise.all(batch.map((item) => uploadEncryptedAttachment(item.file)));
          const chatKey = await ensureChatKey(selectedChatId);
          const encryptedPayload = await encryptTextForSharedKeyInWorker(
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
      clearComposerAttachments();
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

  async function addFilesToComposer(files: File[]) {
    if (files.length === 0) {
      return;
    }
    const nextItems = await Promise.all(files.map((file) => buildComposerAttachment(file)));
    setComposerAttachments((current) => [...current, ...nextItems]);
  }

  function removeComposerAttachment(attachmentId: string) {
    setComposerAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }

  function clearComposerAttachments() {
    setComposerAttachments((current) => {
      current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }

  function addFilesFromFileList(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    void addFilesToComposer(Array.from(fileList));
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
      void addFilesToComposer(files);
    }
  }

  async function handleCreateAvatarChange(file: File | null) {
    if (!file) {
      setChatAvatarDataUrl("");
      return;
    }
    try {
      setStatus("Загружаем аватар чата...");
      setChatAvatarDataUrl(await uploadPublicVisualAsset(token, file, "chat-avatar"));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить аватар");
    }
  }

  async function handleCreateBackgroundChange(file: File | null) {
    if (!file) {
      setChatBackgroundDataUrl("");
      return;
    }
    try {
      setStatus("Загружаем фон чата...");
      setChatBackgroundDataUrl(await uploadPublicVisualAsset(token, file, "chat-background"));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить фон");
    }
  }

  async function handleEditAvatarChange(file: File | null) {
    if (!file) {
      setEditChatAvatarDataUrl("");
      return;
    }
    try {
      setStatus("Загружаем аватар чата...");
      setEditChatAvatarDataUrl(await uploadPublicVisualAsset(token, file, "chat-avatar"));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить аватар");
    }
  }

  async function handleEditBackgroundChange(file: File | null) {
    if (!file) {
      setEditChatBackgroundDataUrl("");
      return;
    }
    try {
      setStatus("Загружаем фон чата...");
      setEditChatBackgroundDataUrl(await uploadPublicVisualAsset(token, file, "chat-background"));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить фон");
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
    const chatTime = formatChatListTime(lastMessage?.created_at ?? chat.last_message_at ?? chat.updated_at);
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
              <button
                className="chat-meta-pill"
                onClick={() => {
                  if (selectedDirectPeer) {
                    onOpenProfile(selectedDirectPeer);
                    return;
                  }
                  setChatInfoModalOpen(true);
                }}
                type="button"
              >
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
                  <span>{getChatMemberCount(selectedChat)} участников</span>
                </div>
              </div>
              <div className="result-list">
                {(selectedChat.members ?? []).map((member) => (
                  <div className="result-row" key={member.user.id}>
                    <button className="username-link result-username-link" onClick={() => onOpenProfile(member.user)} type="button">
                      {member.user.username} · {humanizeStatus(member.user.status)}
                    </button>
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
                {(selectedChat.members ?? []).map((member) => (
                  <div className="result-row" key={member.user.id}>
                    <button className="username-link result-username-link" onClick={() => onOpenProfile(member.user)} type="button">
                      {member.user.username} ({member.role})
                    </button>
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

          {messagesLoading && messages.length === 0 ? <ChatMessagesSkeleton /> : null}
        {loadingOlderMessages ? <p className="form-status">Подгружаем предыдущие сообщения...</p> : null}
        {selectedChatId && !messagesLoading && messages.length === 0 ? <p className="form-status">Пока нет сообщений</p> : null}
        {messages.length > 0 ? (
          <VirtualMessageList
            onAtBottomChange={setIsMessageListAtBottom}
            canManageMessage={canManageMessage}
            chatId={selectedChatId}
            currentUserId={me.id}
            decodeMap={decodeMap}
            ensureChatKey={ensureChatKey}
            hasMore={messagesHasMore}
            messages={messages}
            onLoadOlder={() => void loadOlderMessages()}
            onMediaReady={() => {
              if (isMessageListAtBottomRef.current) {
                scrollToBottom();
              }
            }}
            onOpenContextMenu={(message, x, y) =>
              setContextMenu({
                message,
                x,
                y,
              })
            }
            onOpenProfile={onOpenProfile}
            onPreviewMedia={(url, mediaType) => {
              setPreviewMediaUrl(url);
              setPreviewMediaType(mediaType);
            }}
            token={token}
            virtuosoRef={virtuosoRef}
          />
        ) : null}

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
            placeholder={isRecordingVoice ? "Идет запись голосового..." : "Сообщение"}
            value={messageText}
          />
          <button
            aria-label={isRecordingVoice ? "Остановить запись голосового" : "Записать голосовое"}
            className={`composer-icon-button composer-voice-button ${isRecordingVoice ? "recording" : ""}`}
            disabled={!selectedChatId || isSendingMessage}
            onClick={() => void handleVoiceRecordToggle()}
            type="button"
          >
            {isRecordingVoice ? <Square size={16} /> : <Mic size={16} />}
          </button>
          <button
            disabled={!selectedChatId || isSendingMessage || (!messageText.trim() && composerAttachments.length === 0)}
            type="submit"
          >
            {isSendingMessage ? "Отправка..." : "Отправить"}
          </button>
        </form>

        {composerAttachments.length > 0 ? (
          <div className="attachment-list">
            {composerAttachments.map((item) =>
              item.kind === "voice" && item.previewUrl ? (
                <div className="voice-preview-card" key={item.id}>
                  <audio className="voice-preview-audio" controls preload="metadata" src={item.previewUrl} />
                  <div className="voice-preview-meta">
                    <span>{formatDuration(item.durationSeconds)}</span>
                    <span>{formatFileSize(item.file.size)}</span>
                  </div>
                  <button aria-label="Убрать голосовое" className="voice-preview-remove" onClick={() => removeComposerAttachment(item.id)} type="button">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="attachment-chip" key={item.id}>
                  <span>{item.file.name}</span>
                  <button aria-label="Убрать файл" onClick={() => removeComposerAttachment(item.id)} type="button">
                    <X size={14} />
                  </button>
                </div>
              ),
            )}
          </div>
        ) : null}

        {isRecordingVoice ? (
          <div className="voice-recording-indicator">
            <span className="voice-recording-dot" />
            <span>Запись идет</span>
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

function toStoredPublicUser(user: UserPublic | CurrentUser): UserPublic {
  if (!("email" in user)) {
    return user;
  }
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    nickname: user.nickname,
    profile_status: user.profile_status,
    profile_banner_url: user.profile_banner_url,
    profile_background_url: user.profile_background_url,
    profile_photos: JSON.stringify(user.profile_photos ?? []),
    avatar_ring_style: user.avatar_ring_style,
    avatar_url: user.avatar_url,
    status: user.status,
    current_game: user.current_game,
  };
}

function ChatMessagesSkeleton() {
  return (
    <div className="message-skeleton-list" aria-hidden="true">
      {Array.from({ length: 7 }, (_value, index) => {
        const mine = index % 3 === 2;
        return (
          <div className={`message-row ${mine ? "mine" : "other"}`} key={`skeleton-${index}`}>
            <div className={`message message-skeleton ${mine ? "mine" : ""}`}>
              <div className="message-skeleton-head">
                <span className="message-skeleton-avatar" />
                <span className="message-skeleton-line short" />
              </div>
              <span className="message-skeleton-line full" />
              <span className="message-skeleton-line medium" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function useIsTauriDesktop(): boolean {
  const [desktop, setDesktop] = React.useState(false);

  React.useEffect(() => {
    setDesktop(hasTauriIpc());
  }, []);

  return desktop;
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

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
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

async function uploadPublicVisualAsset(token: string, file: File, category: string): Promise<string> {
  const uploaded = await uploadPublicMedia(token, file, category);
  return uploaded.asset_url;
}

async function buildComposerAttachment(file: File): Promise<ComposerAttachment> {
  const isVoice = file.type.startsWith("audio/");
  const previewUrl = isVoice ? URL.createObjectURL(file) : null;
  const durationSeconds = previewUrl ? await readAudioDuration(previewUrl) : null;
  return {
    id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
    file,
    kind: isVoice ? "voice" : "file",
    previewUrl,
    durationSeconds,
  };
}

async function readAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const cleanup = () => {
      audio.removeAttribute("src");
      audio.load();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
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

function formatDuration(value: number | null): string {
  if (!value || !Number.isFinite(value)) {
    return "00:00";
  }
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFileSize(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function getChatListPreview(
  chat: Chat,
  lastMessage: Message | null,
  decodedMap: Record<string, string> | undefined,
): string {
  if (!lastMessage) {
    return chat.type === "group" ? `${getChatMemberCount(chat)} участника` : "Личный чат";
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
  const cached = chatKeyCache.get(chatId);
  if (cached) {
    return cached;
  }
  const pending = deriveDeterministicChatKey(chatId).then((derived) => {
    const storageKey = `${CHAT_KEY_PREFIX}${chatId}`;
    if (localStorage.getItem(storageKey) !== derived) {
      localStorage.setItem(storageKey, derived);
    }
    return derived;
  });
  chatKeyCache.set(chatId, pending);
  return pending;
}

async function deriveDeterministicChatKey(chatId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`frcenter:${chatId}`));
  return bytesToBase64(new Uint8Array(digest));
}

ReactDOM.createRoot(document.getElementById("root")!).render(<BootstrapApp />);
