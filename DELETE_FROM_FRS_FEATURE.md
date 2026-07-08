# Delete from FRS Server Feature

## Overview
Enhanced delete functionality that removes cards from **both** the FRS server and the local database, ensuring truly permanent deletion that won't re-sync.

## Features

### Two Delete Modes

#### 1. **Local Only** (Orange)
- Deletes card from local database only
- Removes local image files
- Card remains on FRS server
- **Will re-sync** on next automatic sync
- Use case: Temporary removal, testing, or when FRS server is offline

#### 2. **FRS + Local** (Red - Permanent)
- Deletes card from FRS server first (via API)
- Then deletes from local database
- Removes local image files
- **Permanent deletion** - won't re-sync
- Use case: Complete removal of unwanted cards

## API Endpoint

### `/api/cards/delete-from-frs`

**Method:** POST

**Request Body:**
```json
{
  "server_url": "http://172.203.130.108/",
  "card_id": "64"
}
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

**Partial Success Response** (FRS delete failed but local succeeded):
```json
{
  "success": true,
  "message": "Card deleted from local database only (FRS deletion failed)",
  "deletedCard": {
    "server_url": "http://172.203.130.108/",
    "card_id": "64",
    "name": "jamvant thekedar"
  },
  "operations": {
    "frsDeleted": false,
    "frsError": "FRS server returned 404: Not Found",
    "localDeleted": true,
    "imagesDeleted": 1
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Server configuration not found",
  "details": "..."
}
```

## Implementation Details

### Delete Flow

```
User clicks "Delete Card"
         ↓
Choose delete mode:
  ├─ Local Only (Orange)
  │   └─→ /api/cards/delete
  │        └─→ Local DB deletion
  │
  └─ FRS + Local (Red)
      └─→ /api/cards/delete-from-frs
           ├─→ 1. Delete from FRS server
           │    curl -X DELETE "http://server/cards/humans/{id}/"
           │    -H "Authorization: Token {token}"
           │
           ├─→ 2. Delete from local DB
           │    DBService.deleteCard(server_url, card_id)
           │
           └─→ 3. Delete local images
                fs.unlinkSync(imagePath)
```

### FRS Server API Call

The endpoint uses the FindFace API to delete cards:

```bash
curl -X DELETE "http://{server_ip}/cards/humans/{card_id}/" \
  -H "Authorization: Token {server_token}"
```

**Response Handling:**
- **200-204**: Success, card deleted from FRS
- **404**: Card already deleted or doesn't exist (treated as success)
- **401/403**: Authentication error (shown to user)
- **Timeout**: FRS server unreachable (deletes locally anyway)

### Error Handling Strategy

The implementation uses a **graceful degradation** approach:

1. **FRS Delete Attempt**: Try to delete from FRS server
   - If successful: ✅ Continue to local deletion
   - If fails: ⚠️ Log error but continue to local deletion

2. **Local Delete**: Always attempt local deletion
   - If successful: ✅ Return success (with FRS status)
   - If fails: ❌ Return error

3. **Image Delete**: Try to delete local images
   - If successful: ✅ Increment count
   - If fails: ⚠️ Log error but don't fail operation

**Rationale:** 
- Prioritize local database consistency
- Even if FRS deletion fails, user can retry or delete manually
- Prevents orphaned database entries

## UI Updates

### Card Details Drawer

**Before clicking Delete:**
```
┌─────────────────────────────────────┐
│  ... card details ...               │
├─────────────────────────────────────┤
│  🗑️  Delete Card                   │ ← Click to start
│  Close                              │
└─────────────────────────────────────┘
```

**After clicking Delete - Mode Selection:**
```
┌─────────────────────────────────────┐
│  ⚠️  Choose deletion option:        │
│  Delete only from local database.   │
│  Card will re-sync from FRS server. │
├─────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐    │
│  │ Local Only │  │ FRS + Local│    │ ← Choose mode
│  │ Will re-   │  │ Permanent  │    │
│  │ sync       │  │            │    │
│  └────────────┘  └────────────┘    │
│     (Orange)        (Red)           │
├─────────────────────────────────────┤
│  [ Cancel ]  [ Delete Locally ]    │
└─────────────────────────────────────┘
```

**When "FRS + Local" selected:**
```
┌─────────────────────────────────────┐
│  ⚠️  Choose deletion option:        │
│  Delete from both FRS server and    │
│  local database. This is permanent! │
├─────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐    │
│  │ Local Only │  │█FRS + Local│    │ ← Selected
│  │ Will re-   │  │█Permanent █│    │
│  │ sync       │  │████████████│    │
│  └────────────┘  └────────────┘    │
├─────────────────────────────────────┤
│  [ Cancel ]  [ Delete Permanently ] │
└─────────────────────────────────────┘
```

### User Notifications

**Success - Both deleted:**
```
✅ Card deleted from both FRS server and local database!
```

**Partial Success - FRS failed:**
```
⚠️ Card deleted locally, but FRS deletion failed:
FRS server returned 404: Not Found

The card will re-sync on next refresh.
```

**Error:**
```
Failed to delete card: Server configuration not found
```

## Testing

### Test Case 1: Delete from both FRS and Local

```bash
# 1. Check card exists
curl -s http://localhost:3000/api/cards | jq '.data[] | select(.card_id == "64")'

# 2. Delete from both
curl -X POST http://localhost:3000/api/cards/delete-from-frs \
  -H "Content-Type: application/json" \
  -d '{"server_url":"http://172.203.130.108/","card_id":"64"}'

# 3. Verify local deletion
curl -s http://localhost:3000/api/cards | jq '.data[] | select(.card_id == "64")'
# Should return nothing

# 4. Trigger sync - card should NOT come back
curl -X POST http://localhost:3000/api/sync
curl -s http://localhost:3000/api/cards | jq '.data[] | select(.card_id == "64")'
# Should still return nothing

# 5. Verify image deleted
ls public/uploads/*-64.jpg
# Should return: No such file or directory
```

### Test Case 2: FRS Server Offline

```bash
# Simulate offline server by using wrong card_id or offline server
curl -X POST http://localhost:3000/api/cards/delete-from-frs \
  -H "Content-Type: application/json" \
  -d '{"server_url":"http://172.203.130.108/","card_id":"99999"}'

# Should succeed locally even if FRS fails
# Response: "frsDeleted": false, "localDeleted": true
```

### Test Case 3: Invalid Server

```bash
curl -X POST http://localhost:3000/api/cards/delete-from-frs \
  -H "Content-Type: application/json" \
  -d '{"server_url":"http://invalid-server/","card_id":"64"}'

# Should return 404: Server configuration not found
```

## Security Considerations

### Current Implementation
- ✅ Server URL validated against config
- ✅ Authorization token from config
- ✅ Timeout protection (10 seconds)
- ❌ No user authentication
- ❌ No deletion audit log
- ❌ No rate limiting

### Production Recommendations
1. **Add Authentication**: Require user login before deleting
2. **Add Authorization**: Role-based permissions (admin only)
3. **Add Audit Log**: Track who deleted what and when
4. **Add Rate Limiting**: Prevent abuse
5. **Add Confirmation Token**: Require secondary confirmation for permanent deletes
6. **Add Soft Delete**: Allow restoration within time window
7. **Add Webhook**: Notify on deletions

## Comparison: Local vs FRS+Local Delete

| Feature | Local Only | FRS + Local |
|---------|-----------|-------------|
| **Speed** | Fast (1 DB call) | Slower (API + DB call) |
| **Permanence** | Temporary | Permanent |
| **Re-sync** | ✅ Will re-sync | ❌ Won't re-sync |
| **FRS Server** | Not affected | Card removed |
| **Use Case** | Testing, temp removal | Permanent deletion |
| **Risk** | Low | High |
| **Offline Safe** | ✅ Yes | ⚠️ Partial (local only) |
| **Color** | 🟧 Orange | 🔴 Red |

## Known Issues & Limitations

### 1. FRS API Version Compatibility
- Tested with FindFace Multi v4.x API
- Endpoint: `/cards/humans/{id}/`
- May need adjustment for other versions

### 2. Network Failures
- FRS deletion may timeout (10 second limit)
- Local deletion proceeds anyway
- User notified of partial success

### 3. No Undo
- FRS deletion is immediate and permanent
- No restoration mechanism
- Consider backup strategy before mass deletions

### 4. Concurrent Sync
- If sync runs during deletion, race condition possible
- Card might re-appear briefly
- Mitigated by sync debouncing

## Future Enhancements

1. **Batch Delete**: Delete multiple cards at once
2. **Delete Confirmation**: Require typing card name
3. **Dry Run Mode**: Preview what will be deleted
4. **Undo Window**: 5-minute restoration period
5. **Backup Before Delete**: Auto-backup deleted cards
6. **Cascade Delete**: Delete related data (events, matches)
7. **Schedule Delete**: Delete at specific time
8. **Archive Instead**: Move to archive instead of delete

## Troubleshooting

### Card deleted locally but re-appears
**Cause:** FRS deletion failed, card re-synced  
**Solution:** Use "FRS + Local" delete mode, check FRS server connectivity

### "Server configuration not found" error
**Cause:** Server URL doesn't match any in config.json  
**Solution:** Verify server_url matches exactly (trailing slash matters)

### "FRS server returned 401" error
**Cause:** Invalid or expired token  
**Solution:** Update token in config.json, restart server

### Card shows as deleted but still in FRS
**Cause:** Used "Local Only" mode  
**Solution:** Use "FRS + Local" mode to delete from FRS server

### Images not deleted
**Cause:** File permissions or path issue  
**Solution:** Check server logs, verify /public/uploads/ permissions

## Related Documentation

- `DELETE_CARD_FEATURE.md` - Original local-only delete feature
- `DELETE_CARD_USER_GUIDE.md` - User guide for delete features
- `SQLITE_IMPLEMENTATION.md` - Database schema and operations
- FRS API docs - FindFace Multi API reference
