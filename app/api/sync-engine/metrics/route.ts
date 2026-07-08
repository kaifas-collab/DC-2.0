import { NextResponse } from 'next/server'
import { getMetricsSnapshot } from '@/lib/sync/metrics'

// GET /api/sync-engine/metrics - observability snapshot for the operator dashboard.
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: getMetricsSnapshot() })
  } catch (error) {
    console.error('Error fetching sync engine metrics:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch sync engine metrics' }, { status: 500 })
  }
}
