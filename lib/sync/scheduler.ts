// In-process Scheduler (RFC Phase 2/10 - the deferred component every other module points at).
//
// configValidator.ts, worker/run/route.ts and cursors.ts each note that periodic ticking was
// "deferred to the Scheduler component". This is that component. It owns four independent loops:
//
//   - worker      : drains the card_placements queue (runWorkerBatch) - the actual upload path.
//   - reconcile   : reconcileAllPlacements() to catch fan-out drift the reactive planner missed.
//   - validation  : validateAllServers() so a fixed watchlist re-enqueues skipped placements.
//   - download    : (opt-in, OFF by default) self-triggers POST /api/sync so new cards are pulled
//                   + classified without a browser tab open. Needs an HTTP origin, hence opt-in.
//
// Design notes:
//   - Single process, single better-sqlite3 connection: no external job runner needed at pilot
//     scale. The RFC's Postgres/multi-worker story (SKIP LOCKED) is the enterprise upgrade path.
//   - Each loop self-reschedules via setTimeout (never setInterval) so a slow tick can never
//     overlap its own next run - important because a large backlog drain or a slow FRS server can
//     make one tick take longer than its interval.
//   - Every tick body is wrapped so a thrown error is logged and the loop keeps going - a
//     scheduler that dies on the first transient FRS hiccup would be worse than none.
//   - A globalThis guard makes start idempotent across dev HMR re-imports (register() itself runs
//     once per process, but module graphs can be re-evaluated).
import { runWorkerBatch } from './worker'
import { reconcileAllPlacements } from './planner'
import { bootstrapRegistry } from './registry'
import { validateAllServers } from './configValidator'
import { getServerConfig } from '@/config/serverConfig'
import { isSyncPaused } from './pause'
import logger from '../logger'

export interface SchedulerConfig {
  enabled: boolean
  bootstrapOnStart: boolean
  workerIntervalMs: number
  reconcileIntervalMs: number
  validationIntervalMs: number
  // 0 (default) disables the self-triggered download loop. When > 0, the scheduler POSTs to
  // `${selfBaseUrl}/api/sync` on this interval so the pull->classify->plan half runs headless.
  downloadIntervalMs: number
  selfBaseUrl: string
  batchSize: number
  // Upper bound on batches drained per worker tick, so one tick can't run unbounded on a huge
  // backlog - whatever is left is claimed on the next tick.
  maxBatchesPerTick: number
}

const DEFAULTS: SchedulerConfig = {
  enabled: true,
  bootstrapOnStart: true,
  workerIntervalMs: 15_000,
  reconcileIntervalMs: 300_000,
  validationIntervalMs: 600_000,
  downloadIntervalMs: 0,
  selfBaseUrl: 'http://127.0.0.1:3000',
  batchSize: 20,
  maxBatchesPerTick: 100,
}

function resolveConfig(): SchedulerConfig {
  let fromFile: Partial<SchedulerConfig> = {}
  try {
    const appConfig = getServerConfig() as { sync?: { scheduler?: Partial<SchedulerConfig> } }
    fromFile = appConfig.sync?.scheduler ?? {}
  } catch (error) {
    console.warn('⚠️ Scheduler: could not read config.json, using defaults:', error instanceof Error ? error.message : error)
  }
  return { ...DEFAULTS, ...fromFile }
}

// --- singleton state (survives dev HMR via globalThis) -----------------------------------------

interface SchedulerState {
  started: boolean
  timers: Record<string, ReturnType<typeof setTimeout>>
}

const g = globalThis as unknown as { __syncScheduler?: SchedulerState }

function getState(): SchedulerState {
  if (!g.__syncScheduler) {
    g.__syncScheduler = { started: false, timers: {} }
  }
  return g.__syncScheduler
}

function workerId(): string {
  return `scheduler-${process.pid}-${Date.now()}`
}

// --- loop primitive ----------------------------------------------------------------------------

// Self-rescheduling timer: runs `fn`, and only after it settles schedules the next run. Guarantees
// non-overlap of a loop with itself and keeps ticking regardless of whether `fn` threw.
function startLoop(state: SchedulerState, key: string, fn: () => Promise<void>, intervalMs: number, initialDelayMs: number): void {
  const tick = async (): Promise<void> => {
    try {
      await fn()
    } catch (error) {
      logger.error('sync.scheduler', `Scheduler loop "${key}" errored (continuing)`, { loop: key, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (state.started) {
        state.timers[key] = setTimeout(tick, intervalMs)
      }
    }
  }
  state.timers[key] = setTimeout(tick, initialDelayMs)
}

// --- tick bodies -------------------------------------------------------------------------------

async function workerDrain(cfg: SchedulerConfig): Promise<void> {
  const totals = { batches: 0, claimed: 0, synced: 0, deleted: 0, skippedConfigInvalid: 0, failed: 0, deadLettered: 0 }

  for (let i = 0; i < cfg.maxBatchesPerTick; i++) {
    const summary = await runWorkerBatch(workerId(), cfg.batchSize)
    totals.batches++
    totals.claimed += summary.claimed
    totals.synced += summary.synced
    totals.deleted += summary.deleted
    totals.skippedConfigInvalid += summary.skippedConfigInvalid
    totals.failed += summary.failed
    totals.deadLettered += summary.deadLettered

    // Queue drained (or nothing was claimable this pass) - stop, don't busy-loop until next tick.
    if (summary.claimed === 0) break
  }

  if (totals.claimed > 0) {
    logger.info('sync.scheduler', `Worker tick: ${totals.claimed} claimed across ${totals.batches} batch(es) - ${totals.synced} synced, ${totals.deleted} deleted, ${totals.failed} failed, ${totals.skippedConfigInvalid} skipped(config), ${totals.deadLettered} dead-lettered`, totals)
  }
}

async function reconcileSweep(): Promise<void> {
  // A cluster delete is in flight - skip this sweep so it can't re-stale/recreate placements while
  // the delete is resolving. Resumes automatically once isSyncPaused() clears.
  if (isSyncPaused()) {
    return
  }
  const results = reconcileAllPlacements()
  const created = results.reduce((sum, r) => sum + r.createdPlacements, 0)
  const restaled = results.reduce((sum, r) => sum + r.restaledPlacements, 0)
  if (created > 0 || restaled > 0) {
    logger.info('sync.scheduler', `Reconcile: ${created} placement(s) created, ${restaled} re-staled across ${results.length} card(s)`, { created, restaled, cards: results.length })
  }
}

async function validationSweep(): Promise<void> {
  const outcomes = await validateAllServers()
  const invalid = outcomes.filter((o) => o.status !== 'valid')
  if (invalid.length > 0) {
    logger.warn('sync.scheduler', `Validation: ${invalid.length}/${outcomes.length} server(s) not valid: ${invalid.map((o) => `${o.server.name}=${o.status}`).join(', ')}`, {
      invalid: invalid.map((o) => ({ server: o.server.name, status: o.status })),
    })
  }
}

async function downloadTick(cfg: SchedulerConfig): Promise<void> {
  // A cluster delete is in flight - POST /api/sync would just 409, so skip the round-trip entirely.
  if (isSyncPaused()) {
    return
  }
  // Lazy import so a Node build without global fetch still resolves - axios is already a dependency
  // and uses the Node http adapter here.
  const axios = (await import('axios')).default
  const url = `${cfg.selfBaseUrl.replace(/\/$/, '')}/api/sync`
  const response = await axios.post(url, {}, { timeout: 300_000 })
  const stats = response.data?.stats
  if (stats) {
    logger.info('sync.scheduler', `Download tick: ${stats.successful} server(s) ok, ${stats.failed} failed, ${stats.totalCards} total cards mirrored`, stats)
  }
}

// --- public API --------------------------------------------------------------------------------

export function startScheduler(): void {
  const state = getState()
  if (state.started) {
    return
  }

  const cfg = resolveConfig()
  if (!cfg.enabled) {
    logger.info('sync.scheduler', 'Sync scheduler disabled (sync.scheduler.enabled = false) - upload/reconcile will not run automatically')
    return
  }

  state.started = true

  // One-time startup bootstrap: guarantees the servers registry + canonical watchlists exist so
  // the planner has targets and the worker has something to claim. Idempotent - safe every boot.
  if (cfg.bootstrapOnStart) {
    try {
      const result = bootstrapRegistry()
      logger.info('sync.scheduler', `Startup: registry bootstrapped (${result.servers.length} server(s), ${result.canonicalWatchlists.length} watchlist(s))`, {
        servers: result.servers.length,
        watchlists: result.canonicalWatchlists.length,
      })
    } catch (error) {
      logger.error('sync.scheduler', 'Startup: registry bootstrap failed (loops still starting)', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // Stagger initial runs so a fresh boot doesn't fire everything in the same tick.
  startLoop(state, 'worker', () => workerDrain(cfg), cfg.workerIntervalMs, 3_000)
  startLoop(state, 'reconcile', () => reconcileSweep(), cfg.reconcileIntervalMs, 10_000)
  startLoop(state, 'validation', () => validationSweep(), cfg.validationIntervalMs, 20_000)

  if (cfg.downloadIntervalMs > 0) {
    startLoop(state, 'download', () => downloadTick(cfg), cfg.downloadIntervalMs, 30_000)
    logger.info('sync.scheduler', `Started (worker ${cfg.workerIntervalMs}ms, reconcile ${cfg.reconcileIntervalMs}ms, validation ${cfg.validationIntervalMs}ms, download ${cfg.downloadIntervalMs}ms)`)
  } else {
    logger.info('sync.scheduler', `Started (worker ${cfg.workerIntervalMs}ms, reconcile ${cfg.reconcileIntervalMs}ms, validation ${cfg.validationIntervalMs}ms, download OFF)`)
  }
}

export function stopScheduler(): void {
  const state = getState()
  state.started = false
  for (const key of Object.keys(state.timers)) {
    clearTimeout(state.timers[key])
    delete state.timers[key]
  }
  logger.info('sync.scheduler', 'Sync scheduler stopped')
}
