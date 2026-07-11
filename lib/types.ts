// Type definitions for the FindFace Recognition System
export interface ServerConfig {
  name: string;
  baseURL: string;
  token: string;
  location: string;
  server_uuid?: string; // stable, DC-assigned identity; auto-filled by lib/sync/registry on first bootstrap
}

export interface AppConfig {
  refreshIntervalSeconds: number;
  servers: ServerConfig[];
  apiEndpoints: {
    cards: string;
    faces: string;
    watchlists: string;
  };
  cacheSettings: {
    maxAgeMinutes: number;
    enableLocalStorage: boolean;
    enableMemoryCache: boolean;
  };
  expectedWatchlists?: string[]; // canonical watchlist names every server must have (config validation)
  sync?: {
    // RFC Phase 6A: off by default. When true, the sync worker stamps meta.dc_global_key onto
    // uploaded cards, letting the classifier adopt a crash-orphaned replica in O(1) instead of
    // relying solely on the mapping-table + fingerprint recovery path.
    stampMetadata: boolean;
    // RFC Phase 7 "Deletes": policy when a replica's card disappears directly on that server while
    // the origin still considers it active. 'recreate' (default) re-pushes it to enforce desired
    // state; 'tombstone' accepts the removal. Defaults to 'recreate' if omitted.
    replicaDeletePolicy?: 'recreate' | 'tombstone';
    // RFC Phase 2/10 in-process Scheduler (lib/sync/scheduler.ts). All fields optional; the
    // scheduler falls back to built-in defaults for anything omitted.
    scheduler?: {
      enabled?: boolean;
      bootstrapOnStart?: boolean;
      workerIntervalMs?: number;
      reconcileIntervalMs?: number;
      validationIntervalMs?: number;
      downloadIntervalMs?: number; // 0 disables the self-triggered download loop
      selfBaseUrl?: string;
      batchSize?: number;
      maxBatchesPerTick?: number;
    };
  };
}

// API Response Types (FRS API format)
export interface CardResponse {
  id: number;
  name: string;
  watch_lists?: number[];
  created_date?: string;
  modified_date?: string;
  active?: boolean;
  filled?: boolean;
  comment?: string;
  meta?: Record<string, any>;
}

export interface FaceResponse {
  id?: number;
  card?: number;
  thumbnail?: string;
  source_photo?: string;
  created_date?: string;
  modified_date?: string;
}

export interface WatchlistResponse {
  id: string | number;
  name: string;
  description?: string;
  created_at?: string;
}

// Unified Card Data (Final merged format)
export interface UnifiedCardData {
  card_id: string;
  name: string;
  comment?: string;
  thumbnail_url: string;
  fullframe_url: string;
  watchlist_name: string;
  server_name: string;
  server_url: string; // Server baseURL for unique identification
  server_location: string;
  last_updated: string;
  
  // Optional fields from FRS API
  photo?: string;
  confidence?: number;
  lists?: number[];
  active?: boolean;
  watches?: any[];
  created_date?: string;
  acknowledged?: boolean;
  on_lists?: any[];
  galleries?: any[];
}

// Logical Card (one row per real-world person, deduplicated across every server that holds a
// copy - see lib/logicalCards.ts). Deliberately excludes local_card_id/server_name: those are
// physical-placement details the deduplicated view shouldn't expose.
export interface LogicalCardData {
  globalCardUuid: string;
  name: string;
  comment: string;
  watchlist: string;
  // Small cropped face image for list/grid display. Falls back to `photo` (the full source image)
  // if no thumbnail has been captured for this card yet.
  thumbnail: string | null;
  // Full-quality source photo - same image actually mirrored to other FRS servers. Used for the
  // "view full size" modal.
  photo: string | null;
  updatedAt: string;
}

// Sync Status
export interface SyncStatus {
  lastSync: Date | null;
  nextSync: Date | null;
  isRefreshing: boolean;
  totalCards: number;
  successfulServers: number;
  failedServers: string[];
  refreshInterval: number; // in seconds
}

// Cache Entry
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Server Status
export interface ServerStatus {
  name: string;
  isOnline: boolean;
  lastChecked: Date;
  cardsCount?: number;
  error?: string;
}
