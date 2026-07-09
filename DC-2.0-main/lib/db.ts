import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// Database path
const DB_PATH = path.join(process.cwd(), 'data', 'frs.db')

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// Initialize SQLite database
export const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('cache_size = -65536')      // 64MB page cache
db.pragma('synchronous = NORMAL')     // Safe with WAL, faster than FULL
db.pragma('temp_store = MEMORY')      // Temp tables in RAM
db.pragma('mmap_size = 268435456')    // 256MB memory-mapped I/O
db.pragma('page_size = 4096')         // Optimal for large datasets

// Create cards table
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    server_url TEXT NOT NULL,
    server_name TEXT NOT NULL,
    server_location TEXT NOT NULL,
    name TEXT NOT NULL,
    comment TEXT,
    photo TEXT,
    confidence REAL,
    lists TEXT,
    active INTEGER DEFAULT 1,
    watches TEXT,
    created_date TEXT,
    acknowledged INTEGER DEFAULT 0,
    on_lists TEXT,
    galleries TEXT,
    watchlist_name TEXT,
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_url, card_id)
  )
`)

// Create indexes for faster queries
db.exec(`CREATE INDEX IF NOT EXISTS idx_server_url ON cards(server_url)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_server_name ON cards(server_name)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_card_id ON cards(card_id)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_name ON cards(name)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_synced_at ON cards(synced_at)`)

// Migration: Add watchlist_name column if it doesn't exist
try {
  db.exec(`ALTER TABLE cards ADD COLUMN watchlist_name TEXT`)
  console.log('✅ Added watchlist_name column to existing database')
} catch (error) {
  // Column already exists, ignore error
  console.log('ℹ️  watchlist_name column already exists')
}

// Migration: Add comment column if it doesn't exist
try {
  db.exec(`ALTER TABLE cards ADD COLUMN comment TEXT`)
  console.log('✅ Added comment column to existing database')
} catch (error) {
  // Column already exists, ignore error
}

// Create sync status table
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_url TEXT UNIQUE NOT NULL,
    server_name TEXT NOT NULL,
    last_sync TEXT,
    status TEXT DEFAULT 'idle',
    error TEXT,
    card_count INTEGER DEFAULT 0
  )
`)

// FTS5 full-text search on name (required for LIKE performance at 100k+ rows)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
    name,
    card_id UNINDEXED,
    server_url UNINDEXED,
    content='cards',
    content_rowid='id'
  )
`)

// Keep FTS index in sync with cards table
db.exec(`
  CREATE TRIGGER IF NOT EXISTS cards_fts_insert AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, name, card_id, server_url)
    VALUES (new.id, new.name, new.card_id, new.server_url);
  END
`)
db.exec(`
  CREATE TRIGGER IF NOT EXISTS cards_fts_delete AFTER DELETE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, name, card_id, server_url)
    VALUES ('delete', old.id, old.name, old.card_id, old.server_url);
  END
`)
db.exec(`
  CREATE TRIGGER IF NOT EXISTS cards_fts_update AFTER UPDATE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, name, card_id, server_url)
    VALUES ('delete', old.id, old.name, old.card_id, old.server_url);
    INSERT INTO cards_fts(rowid, name, card_id, server_url)
    VALUES (new.id, new.name, new.card_id, new.server_url);
  END
`)

console.log('✅ Database initialized at:', DB_PATH)

export default db
