import fs from 'fs'
import path from 'path'
import type { AppConfig } from '@/lib/types'

export function getServerConfig(): AppConfig {
  const configPath = path.join(process.cwd(), 'config', 'config.json')
  const raw = fs.readFileSync(configPath, 'utf-8')
  return JSON.parse(raw) as AppConfig
}
