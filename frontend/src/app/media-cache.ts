type CacheLoader = () => Promise<Blob>;

type MediaCacheEntry = {
  key: string;
  url: string | null;
  promise: Promise<string> | null;
  refCount: number;
  lastUsedAt: number;
  cleanupTimer: number | null;
};

const MEDIA_CACHE_TTL_MS = 2 * 60 * 1000;
const MEDIA_CACHE_MAX_ITEMS = 120;
const mediaCache = new Map<string, MediaCacheEntry>();

export async function acquireCachedMediaUrl(key: string, loader: CacheLoader): Promise<string> {
  const now = Date.now();
  const existing = mediaCache.get(key);
  if (existing) {
    existing.refCount += 1;
    existing.lastUsedAt = now;
    clearCleanupTimer(existing);
    if (existing.url) {
      return existing.url;
    }
    if (existing.promise) {
      return existing.promise;
    }
  }

  const entry: MediaCacheEntry = existing ?? {
    key,
    url: null,
    promise: null,
    refCount: 1,
    lastUsedAt: now,
    cleanupTimer: null,
  };

  entry.promise = loader()
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      entry.url = url;
      entry.promise = null;
      entry.lastUsedAt = Date.now();
      evictIdleEntries();
      return url;
    })
    .catch((error) => {
      mediaCache.delete(key);
      throw error;
    });

  mediaCache.set(key, entry);
  evictIdleEntries();
  return entry.promise;
}

export function releaseCachedMediaUrl(key: string): void {
  const entry = mediaCache.get(key);
  if (!entry) {
    return;
  }

  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsedAt = Date.now();
  if (entry.refCount === 0) {
    scheduleCleanup(entry);
  }
}

function scheduleCleanup(entry: MediaCacheEntry): void {
  clearCleanupTimer(entry);
  entry.cleanupTimer = window.setTimeout(() => {
    const current = mediaCache.get(entry.key);
    if (!current || current.refCount > 0) {
      return;
    }
    disposeEntry(entry.key, current);
  }, MEDIA_CACHE_TTL_MS);
}

function clearCleanupTimer(entry: MediaCacheEntry): void {
  if (entry.cleanupTimer !== null) {
    window.clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
}

function evictIdleEntries(): void {
  if (mediaCache.size <= MEDIA_CACHE_MAX_ITEMS) {
    return;
  }

  const idleEntries = [...mediaCache.values()]
    .filter((entry) => entry.refCount === 0 && !entry.promise)
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  while (mediaCache.size > MEDIA_CACHE_MAX_ITEMS && idleEntries.length > 0) {
    const entry = idleEntries.shift();
    if (!entry) {
      return;
    }
    disposeEntry(entry.key, entry);
  }
}

function disposeEntry(key: string, entry: MediaCacheEntry): void {
  clearCleanupTimer(entry);
  mediaCache.delete(key);
  if (entry.url) {
    URL.revokeObjectURL(entry.url);
  }
}
