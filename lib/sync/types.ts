// Row types for the Sync Control DB (RFC Phase 3). One interface per table.
// This module (Module 1) creates and populates ServerRow and CanonicalWatchlistRow.
// The remaining row types are declared now so later modules (2-7) share a stable schema contract.

export type ConfigStatus = 'valid' | 'config_invalid' | 'unreachable'

export interface ServerRow {
  server_uuid: string
  name: string
  base_url: string
  ip: string | null
  token_ref: string | null
  location: string | null
  config_status: ConfigStatus
  enabled: 0 | 1
  last_validated_at: string | null
  created_at: string
  updated_at: string
}

export interface CanonicalWatchlistRow {
  id: number
  canonical_name: string
  display_name: string | null
  required: 0 | 1
  created_at: string
}

export interface ServerWatchlistRow {
  id: number
  server_uuid: string
  local_watchlist_id: string
  raw_name: string | null
  canonical_name: string
  last_seen_at: string
}

export type GlobalCardStatus = 'active' | 'deleted'

export interface GlobalCardRow {
  global_card_uuid: string
  origin_server_uuid: string
  origin_card_id: string
  name: string | null
  metadata_json: string | null
  image_ref: string | null
  image_hash: string | null
  metadata_hash: string | null
  sync_version: number
  origin_modified_at: string | null
  status: GlobalCardStatus
  created_at: string
  updated_at: string
}

export type PlacementSyncStatus =
  | 'pending'
  | 'in_progress'
  | 'synced'
  | 'failed'
  | 'skipped_config_invalid'
  | 'dead_letter'
  | 'deleted' // Module 6: this replica's card was removed to match a deleted origin card

export interface CardPlacementRow {
  id: number
  global_card_uuid: string
  server_uuid: string
  local_card_id: string | null
  is_origin: 0 | 1
  desired_version: number
  synced_version: number
  sync_status: PlacementSyncStatus
  retry_count: number
  next_attempt_at: string | null
  last_error: string | null
  idempotency_key: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  applied_image_hash: string | null
  created_at: string
  updated_at: string
}

export interface DownloadCursorRow {
  server_uuid: string
  last_modified_cursor: string | null
  last_full_scan_at: string | null
  last_run_at: string | null
}

export interface ConfigValidationResultRow {
  id: number
  server_uuid: string
  validated_at: string
  status: ConfigStatus
  missing_watchlists_json: string | null
  extra_watchlists_json: string | null
  message: string | null
}

export type SyncAuditEventType =
  | 'download_detected'
  | 'new_origin'
  | 'update_detected'
  | 'upload_attempt'
  | 'upload_success'
  | 'upload_failed'
  | 'watchlist_missing'
  | 'skipped'
  | 'retry'
  | 'dead_letter'
  | 'config_validation'
  | 'lease_reaped'
  | 'delete_detected'
  | 'delete_success'
  | 'delete_failed'

export interface SyncAuditLogRow {
  id: number
  event_time: string
  event_type: SyncAuditEventType
  global_card_uuid: string | null
  server_uuid: string | null
  local_card_id: string | null
  sync_version: number | null
  worker_id: string | null
  detail_json: string | null
}
