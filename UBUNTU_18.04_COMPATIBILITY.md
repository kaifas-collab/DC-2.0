# Ubuntu 18.04 Compatibility & Downgrade Notes

## Summary

Project made compatible with Ubuntu 18.04 LTS / Node.js 16. The codebase had
been bumped to Next.js 14 / Node 20 (for Ubuntu 22.04); the changes below revert
the runtime-blocking pieces so it builds and runs on 18.04. No business logic or
features changed.

---

## Why Node 16 on 18.04

Ubuntu 18.04 ships **glibc 2.27**. Node.js 18+ requires **glibc 2.28 or newer**,
so the maximum Node version that runs on 18.04 is **16.x**. Next.js 14 requires
Node ≥ 18.17, so it cannot run on 18.04 — the project is pinned to Next.js 13.5.6,
which supports Node ≥ 16.14.

---

## Key Changes (made for 18.04 compatibility)

### 1. Runtime Environment

| | 22.04 build | 18.04 build |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 18.04 LTS |
| Node.js | 20.x | 16.x |
| npm | 9.x | 8.x |
| glibc | 2.35 | 2.27 |

### 2. Package / Config Changes

| Item | 22.04 build | 18.04 build | Reason |
|---|---|---|---|
| `next` | 14.2.29 | **13.5.6** | Next 14 needs Node ≥ 18.17 |
| `engines.node` | `>=18.0.0` | **`>=16.14.0`** | Match Node 16 on 18.04 |
| `engines.npm` | `>=9.0.0` | **`>=8.0.0`** | npm shipped with Node 16 |
| `@vercel/analytics` import | `@vercel/analytics/next` | **`@vercel/analytics/react`** | `/react` subpath works across the pinned `^1.1.1` range |
| `package-lock.json`, `bun.lockb` | pinned Next 14 | **removed** | Stale lockfiles would re-pin Next 14; regenerated on first `npm install` |

### 3. Packages left unchanged (already Node 16 compatible)

These were **not** downgraded — they build and run fine on Node 16:

| Package | Version | Note |
|---|---|---|
| `better-sqlite3` | 9.6.0 | v9 line supports Node 16 (v11 dropped it) |
| `framer-motion` | 11.3.31 | client library, no Node 18 requirement |
| `lucide-react` | 0.445.0 | — |
| `react` / `react-dom` | 18.2.0 | — |
| `tailwindcss` | 3.x | — |
| `axios` | 1.6.2 | — |

### 4. Engine Requirements (current)

```json
"engines": {
  "node": ">=16.14.0",
  "npm": ">=8.0.0"
}
```

---

## Installation on Ubuntu 18.04

### Install Node.js 16

```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
```

### Install Dependencies

```bash
npm install
```

### Start

```bash
npm run dev          # development
npm run build && npm start  # production
```

See [INSTALLATION_18.04.md](INSTALLATION_18.04.md) for the full setup guide.

---

## Compatibility Matrix

| Component | Ubuntu 18.04 | Notes |
|---|---|---|
| Node.js 16.x | ✅ | Max version for glibc 2.27 |
| npm 8.x | ✅ | Ships with Node 16 |
| Next.js 13.5.6 | ✅ | Requires Node ≥ 16.14 |
| React 18 | ✅ | Production ready |
| better-sqlite3 9.6.0 | ✅ | Node 16 compatible; rebuilt from source via `postinstall` |
| Tailwind CSS 3.x | ✅ | Mature |
| FTS5 (SQLite) | ✅ | Built into SQLite 3.9+ |

---

## Features Unchanged

All business logic, database schema, API endpoints, and UI behaviour are identical.

✅ FRS server integration
✅ Sync functionality
✅ Search and filtering
✅ Bulk delete
✅ Dark/light theme
✅ Pagination
✅ Card details drawer

---

## Known Issues & Solutions

### Node.js version too new / too old

Node 18+ will not run on 18.04 (glibc 2.27). Install Node 16:

```bash
node --version  # must be 16.x
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### better-sqlite3 build error

```bash
sudo apt-get install -y build-essential python3
npm rebuild better-sqlite3
```

### Port 3000 in use

```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

### Permission errors on node_modules

```bash
sudo chown -R $USER:$USER node_modules
```

---

## Database Compatibility

Existing `data/frs.db` files from previous installs are **fully compatible**. No
migration needed.

---

## Verification

```bash
node --version        # v16.x.x
npm --version         # 8.x.x
npm install           # regenerates package-lock.json, builds better-sqlite3
npm run build         # compiles with Next.js 13.5.6
npm run dev           # starts on :3000
curl http://localhost:3000  # returns HTML
```
