import fs from 'fs'
import path from 'path'

// Persistent, append-only logging so sync activity survives after the npm run dev terminal
// scrolls away or is closed - console.log alone was the only record before this, per the
// "we need to create a log where everything is saved" request. One file per calendar day under
// data/logs/ (same parent as the SQLite DB, already gitignored via /data/).
const LOG_DIR = path.join(process.cwd(), 'data', 'logs')

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function currentLogFile(): string {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(LOG_DIR, `${date}.log`)
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function write(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  try {
    ensureLogDir()
    const line = {
      time: new Date().toISOString(),
      level,
      scope,
      message,
      ...(meta ? { meta } : {}),
    }
    fs.appendFileSync(currentLogFile(), JSON.stringify(line) + '\n')
  } catch (error) {
    // Logging must never break the caller - fall back to console only.
    console.error('⚠️ Failed to write log file:', error instanceof Error ? error.message : error)
  }
}

export const logger = {
  info(scope: string, message: string, meta?: Record<string, unknown>): void {
    console.log(`[${scope}] ${message}`, meta ?? '')
    write('INFO', scope, message, meta)
  },
  warn(scope: string, message: string, meta?: Record<string, unknown>): void {
    console.warn(`[${scope}] ${message}`, meta ?? '')
    write('WARN', scope, message, meta)
  },
  error(scope: string, message: string, meta?: Record<string, unknown>): void {
    console.error(`[${scope}] ${message}`, meta ?? '')
    write('ERROR', scope, message, meta)
  },
}

export default logger
