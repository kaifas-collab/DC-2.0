export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerConfig } from '@/config/serverConfig'

export async function GET() {
  const config = getServerConfig()
  return NextResponse.json(config)
}
