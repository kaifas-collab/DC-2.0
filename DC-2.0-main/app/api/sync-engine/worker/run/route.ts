import { NextRequest, NextResponse } from 'next/server'
import { runWorkerBatch } from '@/lib/sync/worker'

// POST /api/sync-engine/worker/run - claim and process one batch of pending/failed placements.
// Body: { batchSize?: number } (default 20). Manual/triggerable for now - periodic scheduling is
// the same deferred Scheduler component noted in Module 2 (owns download ticks, validation
// sweeps, and worker ticks together rather than three separate ad-hoc timers).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { batchSize } = body as { batchSize?: number }
    const workerId = `manual-${process.pid}-${Date.now()}`

    const summary = await runWorkerBatch(workerId, batchSize && batchSize > 0 ? batchSize : 20)

    return NextResponse.json({ success: true, message: 'Worker batch complete', data: summary })
  } catch (error) {
    console.error('Error running sync worker batch:', error)
    return NextResponse.json({ success: false, error: 'Failed to run worker batch' }, { status: 500 })
  }
}
