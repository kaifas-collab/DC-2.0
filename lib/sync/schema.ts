// Sync Control DB schema (RFC Phase 3). Runs against the same SQLite connection/file as the
// existing read-mirror (lib/db.ts) for the pilot deployment; the RFC calls for this control
// plane to graduate to PostgreSQL at enterprise scale (100+ servers, 10M+ cards), at which point
// this file's DDL becomes the migration source of truth.
//
// Tables are created in dependency order: servers before anything that references server_uuid;
// global_cards before card_placements.
import db from '../db'

// servers - server registry (Module 1)
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    server_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    ip TEXT,
    token_ref TEXT,
    location TEXT,
    config_status TEXT NOT NULL DEFAULT 'unreachable',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_validated_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_servers_config_status ON servers(config_status)`)

// canonical_watchlists - logical watchlist registry (Module 1)
db.exec(`
  CREATE TABLE IF NOT EXISTS canonical_watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    required INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)

// server_watchlists - per-server watchlist -> canonical-name map (populated by Module 2)
db.exec(`
  CREATE TABLE IF NOT EXISTS server_watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_uuid TEXT NOT NULL REFERENCES servers(server_uuid),
    local_watchlist_id TEXT NOT NULL,
    raw_name TEXT,
    canonical_name TEXT NOT NULL,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_uuid, local_watchlist_id)
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_server_watchlists_lookup ON server_watchlists(server_uuid, canonical_name)`)

// global_cards - canonical logical card / desired state (populated by Module 3)
db.exec(`
  CREATE TABLE IF NOT EXISTS global_cards (
    global_card_uuid TEXT PRIMARY KEY,
    origin_server_uuid TEXT NOT NULL REFERENCES servers(server_uuid),
    origin_card_id TEXT NOT NULL,
    name TEXT,
    metadata_json TEXT,
    image_ref TEXT,
    image_hash TEXT,
    metadata_hash TEXT,
    sync_version INTEGER NOT NULL DEFAULT 1,
    origin_modified_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(origin_server_uuid, origin_card_id)
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_global_cards_image_hash ON global_cards(image_hash)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_global_cards_metadata_hash ON global_cards(metadata_hash)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_global_cards_status_updated ON global_cards(status, updated_at)`)
// name LIKE '%q%' still full-scans (LIKE can't use a plain index for a leading wildcard), but this
// at least gets exact/prefix lookups for free; graduating to FTS is a documented scale follow-up.
db.exec(`CREATE INDEX IF NOT EXISTS idx_global_cards_name ON global_cards(name)`)

// Migration: comment joins name as a first-class column (not buried in metadata_json) so the
// worker can read it directly when pushing create/update calls to a mirror, same as name.
try {
  db.exec(`ALTER TABLE global_cards ADD COLUMN comment TEXT`)
} catch {
  // Column already exists, ignore.
}

// Migration: a dedicated small thumbnail, separate from image_ref (which stays the full-quality
// source photo used to actually mirror a card's face record onto other FRS servers - degrading
// that would hurt face-recognition matching on replicas). thumbnail_ref is display-only, for the
// DC dashboard's card grid/drawer, so a dense grid doesn't load full-resolution images.
try {
  db.exec(`ALTER TABLE global_cards ADD COLUMN thumbnail_ref TEXT`)
} catch {
  // Column already exists, ignore.
}

// card_placements - the recursion firewall + idempotency guard + work queue (populated by Module 4/5)
db.exec(`
  CREATE TABLE IF NOT EXISTS card_placements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    global_card_uuid TEXT NOT NULL REFERENCES global_cards(global_card_uuid),
    server_uuid TEXT NOT NULL REFERENCES servers(server_uuid),
    local_card_id TEXT,
    is_origin INTEGER NOT NULL DEFAULT 0,
    desired_version INTEGER NOT NULL DEFAULT 1,
    synced_version INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    idempotency_key TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    applied_image_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(global_card_uuid, server_uuid)
  )
`)

// Migration: Module 6 adds applied_image_hash to track which image was last pushed to each
// placement, so the worker only re-uploads a photo when it actually changed (mirrors the
// existing watchlist_name migration pattern in lib/db.ts).
try {
  db.exec(`ALTER TABLE card_placements ADD COLUMN applied_image_hash TEXT`)
} catch {
  // Column already exists, ignore.
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_unique_local
  ON card_placements(server_uuid, local_card_id)
  WHERE local_card_id IS NOT NULL
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_placements_queue ON card_placements(sync_status, next_attempt_at)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_placements_server_status ON card_placements(server_uuid, sync_status)`)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_placements_lease
  ON card_placements(lease_expires_at)
  WHERE sync_status = 'in_progress'
`)

// download_cursors - incremental change detection per server (populated by Module 3)
db.exec(`
  CREATE TABLE IF NOT EXISTS download_cursors (
    server_uuid TEXT PRIMARY KEY REFERENCES servers(server_uuid),
    last_modified_cursor TEXT,
    last_full_scan_at TEXT,
    last_run_at TEXT
  )
`)

// config_validation_results - validation history (populated by Module 2)
db.exec(`
  CREATE TABLE IF NOT EXISTS config_validation_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_uuid TEXT NOT NULL REFERENCES servers(server_uuid),
    validated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL,
    missing_watchlists_json TEXT,
    extra_watchlists_json TEXT,
    message TEXT
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_config_validation_server_time ON config_validation_results(server_uuid, validated_at)`)

// sync_audit_log - append-only event stream (populated by every later module)
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    global_card_uuid TEXT,
    server_uuid TEXT,
    local_card_id TEXT,
    sync_version INTEGER,
    worker_id TEXT,
    detail_json TEXT
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_global_card ON sync_audit_log(global_card_uuid)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_server_time ON sync_audit_log(server_uuid, event_time)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_event_time ON sync_audit_log(event_type, event_time)`)

console.log('✅ Sync control schema initialized')

export default db
