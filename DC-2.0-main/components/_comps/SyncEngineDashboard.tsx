"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  RefreshCw,
  Clock,
  XCircle,
  AlertTriangle,
  ServerOff,
  RotateCcw,
  Timer,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react"

// Status palette (dataviz skill, fixed - never themed, same hex in light/dark; contrast is
// mitigated by always pairing color with an icon + label, never color alone).
const STATUS_COLOR = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const

interface QueueDepthByStatus {
  status: string
  count: number
}

interface ServerLag {
  serverUuid: string
  serverName: string
  configStatus: string
  backlog: number
  oldestPendingAt: string | null
}

interface MetricsSnapshot {
  queueDepth: QueueDepthByStatus[]
  perServerLag: ServerLag[]
  retryRate: { withRetries: number; total: number }
  deadLetterCount: number
  configInvalidCount: number
  averageUploadLatencyMs: number | null
  generatedAt: string
}

interface PlacementRow {
  id: number
  global_card_uuid: string
  server_uuid: string
  server_name: string | null
  local_card_id: string | null
  sync_status: string
  retry_count: number
  last_error: string | null
  updated_at: string
}

interface AuditLogRow {
  id: number
  event_time: string
  event_type: string
  global_card_uuid: string | null
  server_name: string | null
  detail_json: string | null
}

function StatTile({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-6 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={color ? { color, backgroundColor: `${color}1a` } : undefined}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold leading-tight tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    synced: { color: STATUS_COLOR.good, icon: <CheckCircle2 className="size-3" /> },
    failed: { color: STATUS_COLOR.serious, icon: <AlertTriangle className="size-3" /> },
    dead_letter: { color: STATUS_COLOR.critical, icon: <XCircle className="size-3" /> },
    skipped_config_invalid: { color: STATUS_COLOR.warning, icon: <AlertTriangle className="size-3" /> },
    config_invalid: { color: STATUS_COLOR.warning, icon: <AlertTriangle className="size-3" /> },
    unreachable: { color: STATUS_COLOR.critical, icon: <ServerOff className="size-3" /> },
  }
  const entry = map[status]

  if (!entry) {
    return (
      <Badge variant="outline" className="gap-1">
        {status}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1" style={{ color: entry.color, borderColor: `${entry.color}55` }}>
      {entry.icon}
      {status}
    </Badge>
  )
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

export default function SyncEngineDashboard() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [needsAttention, setNeedsAttention] = useState<PlacementRow[]>([])
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [metricsRes, attentionRes, auditRes] = await Promise.all([
        fetch("/api/sync-engine/metrics"),
        fetch("/api/sync-engine/placements?status=failed,dead_letter,skipped_config_invalid"),
        fetch("/api/sync-engine/audit?limit=50"),
      ])

      const [metricsJson, attentionJson, auditJson] = await Promise.all([
        metricsRes.json(),
        attentionRes.json(),
        auditRes.json(),
      ])

      if (metricsJson.success) setMetrics(metricsJson.data)
      if (attentionJson.success) setNeedsAttention(attentionJson.data)
      if (auditJson.success) setAuditLog(auditJson.data)
    } catch (err) {
      console.error("Failed to load sync engine dashboard data:", err)
      setError("Failed to load sync engine data")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const backlog = metrics
    ? (metrics.queueDepth.find((q) => q.status === "pending")?.count || 0) +
      (metrics.queueDepth.find((q) => q.status === "failed")?.count || 0)
    : 0

  const retryPct =
    metrics && metrics.retryRate.total > 0
      ? Math.round((metrics.retryRate.withRetries / metrics.retryRate.total) * 100)
      : 0

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="outline" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Sync Engine</h1>
            <CardDescription>Cross-server card synchronization - queue, health, and audit trail</CardDescription>
          </div>
        </div>
        <Button onClick={loadAll} disabled={isLoading} variant="outline" size="sm" className="gap-2">
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Backlog" value={String(backlog)} icon={<Clock className="size-4" />} />
        <StatTile
          label="Dead Letter"
          value={String(metrics?.deadLetterCount ?? 0)}
          icon={<XCircle className="size-4" />}
          color={STATUS_COLOR.critical}
        />
        <StatTile
          label="Skipped (Config)"
          value={String(metrics?.queueDepth.find((q) => q.status === "skipped_config_invalid")?.count || 0)}
          icon={<AlertTriangle className="size-4" />}
          color={STATUS_COLOR.warning}
        />
        <StatTile
          label="Config-Invalid Servers"
          value={String(metrics?.configInvalidCount ?? 0)}
          icon={<ServerOff className="size-4" />}
          color={(metrics?.configInvalidCount ?? 0) > 0 ? STATUS_COLOR.warning : undefined}
        />
        <StatTile label="Retry Rate" value={`${retryPct}%`} icon={<RotateCcw className="size-4" />} />
        <StatTile
          label="Avg Upload Latency"
          value={formatLatency(metrics?.averageUploadLatencyMs ?? null)}
          icon={<Timer className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(metrics?.queueDepth || []).map((q) => (
            <Badge key={q.status} variant="secondary" className="gap-1.5">
              {q.status}
              <span className="tabular-nums font-semibold">{q.count}</span>
            </Badge>
          ))}
          {metrics && metrics.queueDepth.length === 0 && (
            <p className="text-sm text-muted-foreground">No placements yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Servers</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Server</th>
                <th className="pb-2 pr-4 font-medium">Config Status</th>
                <th className="pb-2 pr-4 font-medium">Backlog</th>
                <th className="pb-2 font-medium">Oldest Pending</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.perServerLag || []).map((s) => (
                <tr key={s.serverUuid} className="border-t">
                  <td className="py-2 pr-4">{s.serverName}</td>
                  <td className="py-2 pr-4">{statusBadge(s.configStatus)}</td>
                  <td className="py-2 pr-4 tabular-nums">{s.backlog}</td>
                  <td className="py-2 text-muted-foreground">{formatRelativeTime(s.oldestPendingAt)}</td>
                </tr>
              ))}
              {metrics && metrics.perServerLag.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    No servers registered - run POST /api/sync-engine/registry first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs attention</CardTitle>
          <CardDescription>Failed, dead-lettered, or config-blocked placements</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Server</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Retries</th>
                <th className="pb-2 pr-4 font-medium">Last Error</th>
                <th className="pb-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {needsAttention.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{p.server_name || p.server_uuid}</td>
                  <td className="py-2 pr-4">{statusBadge(p.sync_status)}</td>
                  <td className="py-2 pr-4 tabular-nums">{p.retry_count}</td>
                  <td className="py-2 pr-4 max-w-md text-muted-foreground">{p.last_error || "—"}</td>
                  <td className="py-2 whitespace-nowrap text-muted-foreground">{formatRelativeTime(p.updated_at)}</td>
                </tr>
              ))}
              {needsAttention.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    Nothing needs attention.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {auditLog.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 border-b py-1.5 last:border-0">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(entry.event_time)}
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {entry.event_type}
                </Badge>
                <span className="truncate text-muted-foreground">{entry.server_name || "—"}</span>
              </div>
            ))}
            {auditLog.length === 0 && <p className="text-muted-foreground">No audit events yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
