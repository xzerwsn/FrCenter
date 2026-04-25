import React from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { Message } from "../api/chats";
import type { UserPublic } from "../api/users";
import { decryptBytesWithSharedKey } from "../crypto/messages";

export type MediaPayloadFile = {
  media_id: string;
  media_url: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  file_nonce: string;
};

export const MediaMessageView = React.memo(function MediaMessageView({
  chatId,
  onMediaReady,
  token,
  raw,
  onPreview,
  ensureChatKey,
}: {
  chatId: string;
  onMediaReady: () => void;
  token: string;
  raw: string;
  onPreview: (url: string, mediaType: string) => void;
  ensureChatKey: (chatId: string) => Promise<string>;
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
  }, [chatId, ensureChatKey, mediaPayloadFiles, onMediaReady, token]);

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
});

const MessageBubble = React.memo(function MessageBubble({
  message,
  isMine,
  decodedText,
  showHeader,
  compactTop,
  compactBottom,
  canManageMessage,
  onOpenContextMenu,
  onPreviewMedia,
  chatId,
  token,
  onMediaReady,
  ensureChatKey,
  onOpenProfile,
}: {
  message: Message;
  isMine: boolean;
  decodedText: string;
  showHeader: boolean;
  compactTop: boolean;
  compactBottom: boolean;
  canManageMessage: boolean;
  onOpenContextMenu: (message: Message, x: number, y: number) => void;
  onPreviewMedia: (url: string, mediaType: string) => void;
  chatId: string;
  token: string;
  onMediaReady: () => void;
  ensureChatKey: (chatId: string) => Promise<string>;
  onOpenProfile: (user: UserPublic) => void;
}) {
  return (
    <div
      className={`message message-enter ${isMine ? "mine" : ""} ${compactTop ? "compact-top" : ""} ${compactBottom ? "compact-bottom" : ""} ${
        !showHeader ? "grouped" : ""
      }`}
      onContextMenu={(event) => {
        if (!canManageMessage) {
          return;
        }
        event.preventDefault();
        onOpenContextMenu(message, event.clientX, event.clientY);
      }}
    >
      {showHeader ? (
        <div className="message-head">
          <div className="message-author">
            <div className="message-avatar">
              {message.sender.avatar_url ? (
                <img alt={message.sender.username} src={message.sender.avatar_url} />
              ) : (
                message.sender.username.slice(0, 1).toUpperCase()
              )}
            </div>
            <button className="username-link message-username" onClick={() => onOpenProfile(message.sender)} type="button">
              {message.sender.username}
            </button>
          </div>
          <time>{formatMessageTime(message.created_at)}</time>
        </div>
      ) : null}
      {message.message_type === "media" ? (
        <MediaMessageView
          chatId={chatId}
          ensureChatKey={ensureChatKey}
          onMediaReady={onMediaReady}
          onPreview={onPreviewMedia}
          raw={decodedText}
          token={token}
        />
      ) : (
        <p>{decodedText}</p>
      )}
    </div>
  );
});

export const VirtualMessageList = React.memo(function VirtualMessageList({
  virtuosoRef,
  chatId,
  token,
  messages,
  decodeMap,
  currentUserId,
  canManageMessage,
  onOpenContextMenu,
  onPreviewMedia,
  onMediaReady,
  onAtBottomChange,
  onLoadOlder,
  hasMore,
  ensureChatKey,
  onOpenProfile,
}: {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  chatId: string;
  token: string;
  messages: Message[];
  decodeMap: Record<string, string>;
  currentUserId: string;
  canManageMessage: (message: Message) => boolean;
  onOpenContextMenu: (message: Message, x: number, y: number) => void;
  onPreviewMedia: (url: string, mediaType: string) => void;
  onMediaReady: () => void;
  onAtBottomChange: (isAtBottom: boolean) => void;
  onLoadOlder: () => void;
  hasMore: boolean;
  ensureChatKey: (chatId: string) => Promise<string>;
  onOpenProfile: (user: UserPublic) => void;
}) {
  const itemContent = React.useCallback(
    (index: number, message: Message) => {
      const previousMessage = index > 0 ? messages[index - 1] : null;
      const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
      const sameSenderAsPrevious = previousMessage?.sender.id === message.sender.id;
      const sameSenderAsNext = nextMessage?.sender.id === message.sender.id;
      return (
      <div
        className={`message-row ${message.sender.id === currentUserId ? "mine" : "other"} ${sameSenderAsPrevious ? "grouped" : ""} ${
          sameSenderAsNext ? "group-continues" : ""
        }`}
      >
        <MessageBubble
          canManageMessage={canManageMessage(message)}
          chatId={chatId}
          compactBottom={sameSenderAsNext}
          compactTop={sameSenderAsPrevious}
          decodedText={decodeMap[message.id] ?? ""}
          ensureChatKey={ensureChatKey}
          isMine={message.sender.id === currentUserId}
          message={message}
          onMediaReady={onMediaReady}
          onOpenContextMenu={onOpenContextMenu}
          onOpenProfile={onOpenProfile}
          onPreviewMedia={onPreviewMedia}
          showHeader={!sameSenderAsPrevious}
          token={token}
        />
      </div>
    );
    },
    [canManageMessage, chatId, currentUserId, decodeMap, ensureChatKey, messages, onMediaReady, onOpenContextMenu, onOpenProfile, onPreviewMedia, token],
  );

  return (
    <Virtuoso
      atBottomStateChange={onAtBottomChange}
      className="message-list"
      computeItemKey={(_index, message) => message.id}
      data={messages}
      followOutput={false}
      increaseViewportBy={{ top: 400, bottom: 800 }}
      initialTopMostItemIndex={Math.max(messages.length - 1, 0)}
      itemContent={itemContent}
      ref={virtuosoRef}
      startReached={() => {
        if (hasMore) {
          onLoadOlder();
        }
      }}
    />
  );
});

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    return legacy ? [legacy] : null;
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
