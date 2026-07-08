// Next.js instrumentation hook - runs once when the server process boots (requires
// experimental.instrumentationHook in next.config.mjs on Next 13).
//
// This is where the in-process sync Scheduler is started. Guarded to the Node.js runtime only:
// the scheduler pulls in better-sqlite3 (a native module) via lib/sync/schema, which must never be
// bundled into the Edge runtime. The dynamic import keeps that dependency out of the Edge graph.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/sync/scheduler')
    startScheduler()
  }
}
