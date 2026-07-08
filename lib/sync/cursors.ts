// Per-server download cursor bookkeeping (RFC Phase 4 Loop 1 / Phase 10).
//
// The existing download loop (app/api/sync/route.ts) still pulls every card on every run - no
// modified_date filter is sent to FRS, so today every run is already a full scan. This module
// records cursor/full-scan state now so the infrastructure is in place; teaching the FRS query
// itself to filter by modified_date is the Phase 10 scalability optimization ("incremental
// everything"), intentionally out of scope here per "do not redesign the existing download".
import db from './schema'
import type { DownloadCursorRow } from './types'

const upsertCursorStmt = db.prepare(`
  INSERT INTO download_cursors (server_uuid, last_modified_cursor, last_run_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(server_uuid) DO UPDATE SET
    last_modified_cursor = CASE
      WHEN excluded.last_modified_cursor IS NOT NULL
       AND (last_modified_cursor IS NULL OR excluded.last_modified_cursor > last_modified_cursor)
      THEN excluded.last_modified_cursor
      ELSE last_modified_cursor
    END,
    last_run_at = CURRENT_TIMESTAMP
`)

const upsertFullScanStmt = db.prepare(`
  INSERT INTO download_cursors (server_uuid, last_full_scan_at, last_run_at)
  VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(server_uuid) DO UPDATE SET
    last_full_scan_at = CURRENT_TIMESTAMP,
    last_run_at = CURRENT_TIMESTAMP
`)

export function getCursor(serverUuid: string): DownloadCursorRow | undefined {
  return db.prepare('SELECT * FROM download_cursors WHERE server_uuid = ?').get(serverUuid) as
    | DownloadCursorRow
    | undefined
}

// Advances the cursor to the max modified_date seen in a batch. Never moves it backwards - the
// CASE guard keeps the highest value across concurrent/out-of-order calls for the same server.
export function advanceCursor(serverUuid: string, maxModifiedDateSeen: string | null): void {
  upsertCursorStmt.run(serverUuid, maxModifiedDateSeen)
}

export function markFullScan(serverUuid: string): void {
  upsertFullScanStmt.run(serverUuid)
}

export function isFullScanDue(serverUuid: string, intervalMs: number): boolean {
  const row = getCursor(serverUuid)
  if (!row || !row.last_full_scan_at) {
    return true
  }
  return Date.now() - new Date(row.last_full_scan_at).getTime() >= intervalMs
}
