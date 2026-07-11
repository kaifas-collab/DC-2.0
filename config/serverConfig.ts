import fs from 'fs'
import path from 'path'
import type { AppConfig } from '@/lib/types'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'config.json')

export function getServerConfig(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(raw) as AppConfig
}

// Atomic write (write-then-rename) so a crash mid-write can never leave config.json truncated or
// corrupted - this file holds live server tokens. Mirrors the same pattern in lib/sync/registry.ts;
// kept here (DB-free) so callers that only touch config don't pull in the sync schema/DB.
export function saveServerConfig(config: AppConfig): void {
  const tmpPath = `${CONFIG_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmpPath, CONFIG_PATH)
}
