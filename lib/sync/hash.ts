// Content hashing for change detection (RFC Phase 7 change detection / Phase 6 classify()).
// Hash differing from the stored value is the actual "did this change" signal - modified_date is
// only a secondary ordering/cursor signal, never the sole gate (clocks can be wrong or absent).
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface CanonicalCardContent {
  name: string
  active: boolean
  canonicalWatchlistNames: string[]
}

export function computeMetadataHash(content: CanonicalCardContent): string {
  const normalized = {
    name: content.name.trim(),
    active: content.active,
    watchlists: [...content.canonicalWatchlistNames].sort(),
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

// photoPath is either a local /uploads/... path (hash the actual bytes) or a remote URL fallback
// (hash the reference string itself - weaker, but we don't have bytes to hash in that case).
export function computeImageHash(photoPath: string | null): string | null {
  if (!photoPath) {
    return null
  }

  if (photoPath.startsWith('/uploads/')) {
    try {
      const fullPath = path.join(process.cwd(), 'public', photoPath)
      const bytes = fs.readFileSync(fullPath)
      return crypto.createHash('sha256').update(bytes).digest('hex')
    } catch {
      // File missing/unreadable - fall through to the URL-based fallback below.
    }
  }

  return crypto.createHash('sha256').update(photoPath).digest('hex')
}
