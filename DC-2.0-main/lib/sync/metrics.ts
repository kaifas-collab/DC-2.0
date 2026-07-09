// Observability (RFC Phase 11): queue depth, per-server lag, retry rate, DLQ size,
// config-invalid count, upload latency - computed entirely from data the engine already writes
// (card_placements, servers, sync_audit_log). No separate metrics store needed at this scale.
import db from './schema'
import type { PlacementSyncStatus } from './types'

export interface QueueDepthByStatus {
  status: PlacementSyncStatus
  count: number
}

export function getQueueDepthByStatus(): QueueDepthByStatus[] {
  return db
    .prepare(`SELECT sync_status as status, COUNT(*) as count FROM card_placements GROUP BY sync_status`)
    .all() as QueueDepthByStatus[]
}

export interface ServerLag {
  serverUuid: string
  serverName: string
  configStatus: string
  backlog: number
  oldestPendingAt: string | null
}

export function getPerServerLag(): ServerLag[] {
  const rows = db
    .prepare(
      `
      SELECT
        s.server_uuid as serverUuid,
        s.name as serverName,
        s.config_status as configStatus,
        COUNT(CASE WHEN cp.sync_status IN ('pending', 'failed') THEN 1 END) as backlog,
        MIN(CASE WHEN cp.sync_status IN ('pending', 'failed') THEN cp.next_attempt_at END) as oldestPendingAt
      FROM servers s
      LEFT JOIN card_placements cp ON cp.server_uuid = s.server_uuid
      WHERE s.enabled = 1
      GROUP BY s.server_uuid
      ORDER BY backlog DESC, s.name
      `
    )
    .all() as ServerLag[]

  return rows
}

export interface RetryRate {
  withRetries: number
  total: number
}

export function getRetryRate(): RetryRate {
  const row = db
    .prepare(
      `
      SELECT
        COUNT(CASE WHEN retry_count > 0 THEN 1 END) as withRetries,
        COUNT(*) as total
      FROM card_placements
      WHERE sync_status IN ('synced', 'failed', 'dead_letter', 'deleted')
      `
    )
    .get() as RetryRate

  return row
}

export function getDeadLetterCount(): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM card_placements WHERE sync_status = 'dead_letter'`).get() as {
    count: number
  }
  return row.count
}

export function getConfigInvalidCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM servers WHERE enabled = 1 AND config_status != 'valid'`)
    .get() as { count: number }
  return row.count
}

// Correlates 'upload_attempt' -> 'upload_success' audit events for the same (card, server,
// version) over the most recent 200 successes - a real, computed latency, not a placeholder.
export function getAverageUploadLatencyMs(): number | null {
  const row = db
    .prepare(
      `
      SELECT AVG(latency_ms) as avgLatencyMs FROM (
        SELECT (julianday(s.event_time) - julianday(a.event_time)) * 86400000 as latency_ms
        FROM sync_audit_log s
        INNER JOIN sync_audit_log a
          ON a.global_card_uuid = s.global_card_uuid
          AND a.server_uuid = s.server_uuid
          AND a.sync_version = s.sync_version
          AND a.event_type = 'upload_attempt'
        WHERE s.event_type = 'upload_success'
        ORDER BY s.event_time DESC
        LIMIT 200
      )
      `
    )
    .get() as { avgLatencyMs: number | null }

  return row.avgLatencyMs
}

export interface MetricsSnapshot {
  queueDepth: QueueDepthByStatus[]
  perServerLag: ServerLag[]
  retryRate: RetryRate
  deadLetterCount: number
  configInvalidCount: number
  averageUploadLatencyMs: number | null
  generatedAt: string
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    queueDepth: getQueueDepthByStatus(),
    perServerLag: getPerServerLag(),
    retryRate: getRetryRate(),
    deadLetterCount: getDeadLetterCount(),
    configInvalidCount: getConfigInvalidCount(),
    averageUploadLatencyMs: getAverageUploadLatencyMs(),
    generatedAt: new Date().toISOString(),
  }
}
