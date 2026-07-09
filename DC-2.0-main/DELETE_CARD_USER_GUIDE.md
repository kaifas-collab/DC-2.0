# How to Delete a Card - User Guide

## Overview

You now have **TWO OPTIONS** for deleting cards:

1. **🟧 Local Only** - Quick delete from local database only (card will re-sync)
2. **🔴 FRS + Local** - Permanent delete from both FRS server and local database

## Quick Steps

### From Server Dashboard View

1. **Navigate to Server Dashboard**
   - Go to: `http://localhost:3000/server?ip=<server-ip>`
   - Or click on a server card from the main dashboard

2. **Select a Card**
   - Click on any card in the grid to open the details drawer

3. **Choose Delete Mode**
   - Click the **"Delete Card"** button at the bottom
   - Choose your deletion mode:
     - **Local Only** (Orange) - Temporary removal, will re-sync
     - **FRS + Local** (Red) - Permanent deletion from everywhere

4. **Confirm Deletion**
   - Review the warning message
   - Click **"Delete Locally"** or **"Delete Permanently"** to confirm
   - Or click **"Cancel"** to abort

5. **Confirmation**
   - Card will be deleted according to your choice
   - Local image files will be removed
   - The drawer will close automatically
   - The card grid will refresh

## Visual Guide

### Step 1: Click Delete Card Button

```
┌─────────────────────────────────────────────┐
│  Card Details Drawer                    [X] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │        [Card Image]                 │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  CARD ID                                    │
│  64                                         │
│                                             │
│  PERSON NAME                                │
│  John Doe                                   │
│                                             │
│  SERVER                                     │
│  ● FRS-Server-1                             │
│  Location Name                              │
│                                             │
│  WATCHLIST                                  │
│  ● VIP Watchlist                            │
│                                             │
│  LAST UPDATED                               │
│  Nov 10, 2025, 10:30:45 AM                  │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  🗑️  Delete Card                   │   │ ← Click here
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  Close                              │   │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### Step 2: Choose Delete Mode

```
┌─────────────────────────────────────────────┐
│  Card Details Drawer                    [X] │
├─────────────────────────────────────────────┤
│  ... (card details above) ...              │
├─────────────────────────────────────────────┤
│                                             │
│  ⚠️  Choose deletion option:                │
│  ┌─────────────────────────────────────┐   │
│  │ Delete only from local database.    │   │
│  │ Card will re-sync from FRS server.  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────┐ ┌─────────────────┐  │
│  │  Local Only      │ │  FRS + Local    │  │
│  │  🟧              │ │  🔴             │  │ ← Choose
│  │  Will re-sync    │ │  Permanent      │  │
│  └──────────────────┘ └─────────────────┘  │
│      (Selected)           (Click here)      │
│                                             │
│  ┌──────────────┐  ┌──────────────────┐   │
│  │   Cancel     │  │ Delete Locally   │   │
│  └──────────────┘  └──────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### Step 3a: Local Only Mode (Orange - Selected)

```
┌─────────────────────────────────────────────┐
│  ⚠️  Choose deletion option:                │
│  ┌─────────────────────────────────────┐   │
│  │ Delete only from local database.    │   │
│  │ Card will re-sync from FRS server.  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────┐ ┌─────────────────┐  │
│  │█ Local Only █████│ │  FRS + Local    │  │
│  │█ Will re-sync ███│ │  Permanent      │  │
│  └──────────────────┘ └─────────────────┘  │
│                                             │
│  ┌──────────────┐  ┌──────────────────┐   │
│  │   Cancel     │  │ 🗑️  Delete      │   │
│  └──────────────┘  │    Locally       │   │
│                    └──────────────────┘   │
└─────────────────────────────────────────────┘
```

### Step 3b: FRS + Local Mode (Red - Selected)

```
┌─────────────────────────────────────────────┐
│  ⚠️  Choose deletion option:                │
│  ┌─────────────────────────────────────┐   │
│  │ Delete from both FRS server and     │   │
│  │ local database. This is permanent!  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────┐ ┌─────────────────┐  │
│  │  Local Only      │ │█ FRS + Local ███│  │
│  │  Will re-sync    │ │█ Permanent █████│  │
│  └──────────────────┘ └─────────────────┘  │
│                                             │
│  ┌──────────────┐  ┌──────────────────┐   │
│  │   Cancel     │  │ 🗑️  Delete      │   │
│  └──────────────┘  │   Permanently    │   │
│                    └──────────────────┘   │
└─────────────────────────────────────────────┘
```

## What Gets Deleted

### 🟧 Local Only Mode

| What | Deleted? | Details |
|------|----------|---------|
| **Local Database** | ✅ Yes | Card removed from SQLite |
| **Local Images** | ✅ Yes | Thumbnail & fullframe deleted |
| **FRS Server** | ❌ No | Card remains on FRS server |
| **Re-sync Behavior** | 🔄 Will Re-appear | Next sync brings it back |

**Use Cases:**
- Testing or debugging
- Temporary removal
- FRS server is offline
- Want to refresh card data

### 🔴 FRS + Local Mode (Permanent)

| What | Deleted? | Details |
|------|----------|---------|
| **FRS Server** | ✅ Yes | Deleted via API |
| **Local Database** | ✅ Yes | Card removed from SQLite |
| **Local Images** | ✅ Yes | Thumbnail & fullframe deleted |
| **Re-sync Behavior** | ✅ Won't Re-appear | Permanent deletion |

**Use Cases:**
- Removing wrong/duplicate cards
- Data cleanup
- Privacy compliance (GDPR, etc.)
- Permanent removal needed

## Important Notes

### 🟧 Local Only Delete

⚠️ **This is temporary!**
- Card remains on FRS server
- Will re-appear on next sync (every 12 seconds by default)
- Useful for testing or temporary removal

💡 **To restore:**
- Just wait for next auto-sync
- Or click "Refresh Now" in dashboard
- Card will be re-downloaded with fresh data

### 🔴 FRS + Local Delete (Permanent)

⚠️ **This action is PERMANENT!**
- Deleted from FRS server immediately
- Cannot be undone from this interface
- Card data cannot be recovered
- Image files are permanently deleted

� **To restore:**
- Must manually re-add to FRS server
- Or restore from FRS server backup
- Dashboard cannot restore deleted cards

### 🔄 Sync Behavior

**Local Only:**
```
Delete → Card gone → Next sync → Card reappears ✅
```

**FRS + Local:**
```
Delete → Card gone → Next sync → Card stays gone ✅
```

## API Usage (for developers)

### Delete Locally Only

```bash
curl -X POST http://localhost:3000/api/cards/delete \
  -H "Content-Type: application/json" \
  -d '{
    "server_url": "http://172.203.130.108/",
    "card_id": "64"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Card deleted successfully",
  "deletedCard": {
    "server_url": "http://172.203.130.108/",
    "card_id": "64"
  }
}
```

### Delete from FRS + Local (Permanent)

```bash
curl -X POST http://localhost:3000/api/cards/delete-from-frs \
  -H "Content-Type: application/json" \
  -d '{
    "server_url": "http://172.203.130.108/",
    "card_id": "64"
  }'
```

**Success Response:**
```json
{
  "success": true,
  "message": "Card deleted from both FRS server and local database",
  "deletedCard": {
    "server_url": "http://172.203.130.108/",
    "card_id": "64",
    "name": "jamvant thekedar"
  },
  "operations": {
    "frsDeleted": true,
    "frsError": null,
    "localDeleted": true,
    "imagesDeleted": 1
  }
}
```

**Partial Success (FRS Failed):**
```json
{
  "success": true,
  "message": "Card deleted from local database only (FRS deletion failed)",
  "operations": {
    "frsDeleted": false,
    "frsError": "FRS server returned 404: Not Found",
    "localDeleted": true,
    "imagesDeleted": 1
  }
}
```

## Comparison Table

| Feature | 🟧 Local Only | 🔴 FRS + Local |
|---------|---------------|----------------|
| **Speed** | ⚡ Fast | 🐢 Slower (API call) |
| **Permanence** | Temporary | Permanent |
| **FRS Server** | Not affected | Card removed |
| **Re-sync** | Will re-appear | Won't re-appear |
| **Offline Safe** | ✅ Always works | ⚠️ Needs FRS online |
| **Use Case** | Testing, temp removal | Permanent deletion |
| **Undo** | Auto (on sync) | ❌ Manual only |
| **Risk Level** | 🟢 Low | 🔴 High |
| **Button Color** | Orange | Red |
| **Endpoints** | `/api/cards/delete` | `/api/cards/delete-from-frs` |

## Troubleshooting

### Card still appears after "Local Only" deletion
- **Cause**: This is expected - next sync brings it back
- **Solution**: Use "FRS + Local" mode for permanent deletion

### Card deleted with "FRS + Local" but re-appears
- **Cause**: FRS deletion failed (server offline/error)
- **Solution**: Check notification message, retry when FRS is online

### "Server configuration not found" error
- **Cause**: Server URL doesn't match config.json
- **Solution**: Contact administrator, verify server configuration

### "FRS server returned 401" error
- **Cause**: Invalid or expired authentication token
- **Solution**: Contact administrator to update FRS token

### Delete button is grayed out
- **Cause**: Previous delete in progress
- **Solution**: Wait for current operation to complete

### Card shows as deleted but still in FRS
- **Cause**: Used "Local Only" mode
- **Solution**: Use "FRS + Local" mode to delete from FRS server

### Alert shows "FRS deletion failed"
- **Cause**: FRS server unreachable or card doesn't exist
- **Solution**: Card deleted locally anyway, won't re-sync if card truly gone from FRS

## Security Notes

🔒 **Current Implementation:**
- No authentication required
- Anyone with access to the dashboard can delete cards
- No audit trail of deletions

⚠️ **Production Recommendations:**
1. Add user authentication
2. Implement role-based permissions
3. Add audit logging
4. Require additional confirmation for bulk operations
5. Consider implementing soft-delete with restoration
