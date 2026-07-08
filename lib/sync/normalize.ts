// Canonical watchlist name normalization (RFC Phase 5).
// NFKC-normalize -> strip zero-width chars -> trim -> lowercase -> collapse internal whitespace.
// Whitespace is only collapsed, never inserted, so "Blacklist" and "Black list" remain distinct.
//
// Zero-width code points (ZERO WIDTH SPACE, ZWNJ, ZWJ, BOM/ZERO WIDTH NO-BREAK SPACE) are built
// from their numeric code points rather than typed as literal characters, since they are
// invisible in source and impossible to eyeball-verify once embedded in a file.
const ZERO_WIDTH_CODE_POINTS = [0x200b, 0x200c, 0x200d, 0xfeff]
const ZERO_WIDTH_CHARS = new RegExp(
  `[${ZERO_WIDTH_CODE_POINTS.map((code) => String.fromCharCode(code)).join('')}]`,
  'g'
)

export function normalizeWatchlistName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
