# Installation Guide — Ubuntu 18.04

## System Requirements

| Requirement | Minimum |
|---|---|
| OS | Ubuntu 18.04 LTS (Bionic) |
| Node.js | 16.x (max supported on 18.04) |
| npm | 8.x |
| glibc | 2.27 (pre-installed on 18.04) |
| RAM | 2 GB |
| Disk | 1 GB free |
| Network | Access to FRS servers |

> **Why Node 16?** Ubuntu 18.04 ships glibc 2.27. Node.js 18+ requires glibc 2.28+,
> so 16.x is the newest version that runs on 18.04. The project is pinned to
> Next.js 13.5.6 accordingly (Next 14 requires Node ≥ 18.17).

---

## 1. Install Node.js 16

```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
```

Verify:

```bash
node --version   # v16.x.x
npm --version    # 8.x.x
```

`build-essential` and `python3` are required to compile the native
`better-sqlite3` module.

---

## 2. Install Project Dependencies

```bash
cd /path/to/project
npm install
```

This also runs `npm rebuild better-sqlite3` automatically via the `postinstall`
script. On the first install npm regenerates `package-lock.json` against the
18.04-compatible `package.json`.

---

## 3. Configure Servers

Edit `config/config.json`:

```json
{
  "refreshIntervalSeconds": 43200,
  "servers": [
    {
      "name": "FRS-Server-1",
      "baseURL": "http://192.168.0.100/",
      "token": "your_jwt_token_here",
      "location": "Office A"
    },
    {
      "name": "FRS-Server-2",
      "baseURL": "http://192.168.0.101/",
      "token": "your_jwt_token_here",
      "location": "Office B"
    }
  ],
  "apiEndpoints": {
    "cards": "cards/humans/",
    "faces": "objects/faces/",
    "watchlists": "/watch-lists/"
  },
  "cacheSettings": {
    "maxAgeMinutes": 60,
    "enableLocalStorage": true,
    "enableMemoryCache": true
  }
}
```

**Fields:**

| Field | Description |
|---|---|
| `name` | Display name for the server |
| `baseURL` | Full URL including port if needed (e.g. `http://192.168.0.100:8080/`) |
| `token` | JWT token for FRS API authentication |
| `location` | Label shown in the dashboard |
| `refreshIntervalSeconds` | Auto-sync interval (43200 = 12 hours) |

Add as many servers as needed inside the `servers` array.

---

## 4. Run Development Server

```bash
npm run dev
```

Open: `http://localhost:3000`

---

## 5. Run Production Build

```bash
npm run build
npm run start
```

By default runs on port 3000. To use a different port:

```bash
npm run start -- -p 8080
```

---

## 6. Optional: Run with PM2 (Recommended for Production)

PM2 keeps the app running after logout and restarts it on crash.

**Install PM2:**

```bash
sudo npm install -g pm2
```

**Start the app:**

```bash
npm run build
pm2 start npm --name "frs-dashboard" -- start
```

**Auto-start on reboot:**

```bash
pm2 startup
pm2 save
```

**Useful PM2 commands:**

```bash
pm2 status               # check running apps
pm2 logs frs-dashboard   # view logs
pm2 restart frs-dashboard
pm2 stop frs-dashboard
```

---

## 7. Troubleshooting

### Wrong Node.js version

```bash
node --version
```

If it shows v18 or higher (which will not run on 18.04's glibc) or below 16,
reinstall Node 16:

```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

### Port 3000 already in use

Find and kill the process:

```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

Or start on a different port:

```bash
npm run start -- -p 8080
```

---

### better-sqlite3 build error

Run manually:

```bash
npm rebuild better-sqlite3
```

If it fails, install build tools:

```bash
sudo apt-get install -y build-essential python3
npm rebuild better-sqlite3
```

---

### Database location

SQLite database is created automatically at:

```
data/frs.db
```

Do not delete this file — it contains all synced records. Back it up regularly:

```bash
cp data/frs.db data/frs.db.backup
```

---

### App shows 0 records after start

Click **Force Refresh** in the dashboard to trigger the first sync from FRS servers. Subsequent syncs run automatically per `refreshIntervalSeconds`.
