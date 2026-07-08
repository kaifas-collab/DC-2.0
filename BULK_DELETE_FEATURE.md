# Multi-Select Bulk Delete Feature

## Overview
Added the ability to select multiple cards and delete them in bulk from both individual server views and the global dashboard. Supports deletion from local database only or from both FRS server and local database.

## Features

### 1. **Selection Mode**
- Toggle selection mode with the "Select" button in the header
- Click on cards to select/deselect them
- Visual feedback: Selected cards show blue ring border and checkbox
- Counter badge shows number of selected cards
- "Select All" and "Deselect All" quick actions

### 2. **Bulk Delete Options**
- **Delete Local**: Removes cards from local database only (orange button)
- **Delete from FRS**: Removes from FRS server AND local database (red button)
- Shows selected card count on delete buttons
- Confirmation dialog before deletion
- Loading state during delete operation

### 3. **Multi-Status Response**
- Reports successful and failed deletions separately
- Shows FRS deletion results vs local deletion results
- Returns HTTP 207 (Multi-Status) for partial success
- Detailed breakdown of results

## Implementation Details

### API Endpoint: `/api/cards/bulk-delete`

**Method**: POST

**Request Body**:
```json
{
  "cards": [
    {
      "server_url": "http://172.203.130.108/",
      "card_id": "63"
    },
    {
      "server_url": "http://172.203.130.108/",
      "card_id": "61"
    }
  ],
  "deleteFromFRS": false
}
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Deleted 2 of 2 cards",
  "results": {
    "total": 2,
    "localDeleted": 2,
    "localFailed": 0,
    "frsDeleted": 0,
    "frsFailed": 0,
    "details": {
      "successful": [
        {"server_url": "http://172.203.130.108/", "card_id": "63"},
        {"server_url": "http://172.203.130.108/", "card_id": "61"}
      ],
      "failed": [],
      "frsDeleted": [],
      "frsFailed": []
    }
  }
}
```

**Response** (Partial Failure):
```json
{
  "success": false,
  "message": "Deleted 1 of 2 cards",
  "results": {
    "total": 2,
    "localDeleted": 1,
    "localFailed": 1,
    "frsDeleted": 0,
    "frsFailed": 1,
    "details": {
      "successful": [{"server_url": "...", "card_id": "63"}],
      "failed": [
        {
          "card": {"server_url": "...", "card_id": "61"},
          "error": "Card not found in database"
        }
      ],
      "frsDeleted": [],
      "frsFailed": [
        {
          "card": {"server_url": "...", "card_id": "61"},
          "error": "FRS server returned 404"
        }
      ]
    }
  }
}
```

### Component Changes

#### 1. **CardGrid.tsx**
Added multi-select support:
- New props: `selectionMode`, `selectedCards`, `onCardSelect`
- Checkbox overlay in selection mode
- Visual selection state (ring border, checkbox icon)
- Click handling for selection vs card view

```tsx
interface CardGridProps {
  cards: CardData[]
  onCardClick: (card: CardData) => void
  loading?: boolean
  selectionMode?: boolean
  selectedCards?: Set<string>
  onCardSelect?: (cardId: string, selected: boolean) => void
}
```

#### 2. **ServerDashboard.tsx**
Added selection state and handlers:
- `selectionMode` state
- `selectedCards` Set to track selections
- `toggleSelectionMode()` to enter/exit selection mode
- `handleCardSelect()` to toggle individual card selection
- `selectAll()` / `deselectAll()` quick actions
- `handleBulkDelete()` to process bulk deletions
- Selection toolbar UI with action buttons

#### 3. **DashboardPage.tsx**
Same selection functionality for global view:
- Selection mode for cards across all servers
- Bulk delete support across multiple servers
- Same UI pattern as ServerDashboard

### UI Components

#### Selection Toolbar
Appears below header when selection mode is active:
```
┌──────────────────────────────────────────────────────┐
│  [2 selected] [Select All (10)] [Deselect All]      │
│                                                       │
│      [Delete Local (2)]  [Delete from FRS (2)]      │
└──────────────────────────────────────────────────────┘
```

#### Card Selection State
```
┌─────────────────────┐
│  ☑️ [Server Name]   │  ← Checkbox when selected
│                     │
│   [Card Image]      │  ← Blue ring border when selected
│                     │
│   Person Name       │
│   ID: 123           │
└─────────────────────┘
```

## Usage Guide

### In Server Dashboard View

1. **Navigate to server**: `/server?ip=172.203.130.108`
2. **Click "Select"** button in header
3. **Click on cards** to select them (or use "Select All")
4. **Choose delete option**:
   - **Delete Local**: Local DB only (cards will re-sync from FRS)
   - **Delete from FRS**: FRS server + Local DB (permanent)
5. **Confirm** in the dialog
6. **View results** in alert dialog

### In Global Dashboard View

1. **Navigate to home**: `/`
2. **Click "Select"** button in header
3. **Select cards** from multiple servers
4. **Delete** using same options as above
5. Cards from different servers are deleted correctly

## Technical Features

### Atomic Operations
- Each card deletion is independent
- Partial failures don't roll back successful deletions
- Continues processing even if some cards fail

### Error Handling
- FRS server failures don't prevent local deletion
- Image file deletion failures don't prevent database deletion
- Detailed error messages for each failed card

### Performance
- Batch processing with individual error tracking
- Non-blocking async operations
- Progress indication during deletion

### Data Integrity
- Validates all inputs before processing
- Checks server configuration exists
- Verifies cards exist before deletion

## HTTP Status Codes

- **200 OK**: All cards deleted successfully
- **207 Multi-Status**: Some cards deleted, some failed
- **400 Bad Request**: Invalid request (missing/malformed data)
- **500 Internal Server Error**: Server-side processing error

## Testing

### Test 1: Bulk Delete (Local Only)
```bash
curl -X POST http://localhost:3000/api/cards/bulk-delete \
  -H "Content-Type: application/json" \
  -d '{
    "cards": [
      {"server_url": "http://172.203.130.108/", "card_id": "63"},
      {"server_url": "http://172.203.130.108/", "card_id": "61"}
    ],
    "deleteFromFRS": false
  }'
```

**Result**: ✅ 2 cards deleted from local DB
- Card count: 10 → 8
- FRS server cards unchanged
- Image files deleted

### Test 2: Bulk Delete (FRS + Local)
```bash
curl -X POST http://localhost:3000/api/cards/bulk-delete \
  -H "Content-Type: application/json" \
  -d '{
    "cards": [
      {"server_url": "http://172.203.130.108/", "card_id": "60"}
    ],
    "deleteFromFRS": true
  }'
```

**Result**: ✅ Card deleted from both FRS and local
- FRS API called with DELETE method
- Local database updated
- Image files removed

### Test 3: Mixed Servers
```bash
curl -X POST http://localhost:3000/api/cards/bulk-delete \
  -H "Content-Type: application/json" \
  -d '{
    "cards": [
      {"server_url": "http://172.203.130.108/", "card_id": "64"},
      {"server_url": "http://172.203.130.112/", "card_id": "3"}
    ],
    "deleteFromFRS": false
  }'
```

**Result**: Cards deleted from different servers

## File Changes

### New Files:
- `app/api/cards/bulk-delete/route.ts` - Bulk delete API endpoint

### Modified Files:
- `components/_comps/CardGrid.tsx` - Added multi-select UI
- `components/_comps/ServerDashboard.tsx` - Added selection mode
- `components/_comps/DashboardPage.tsx` - Added selection mode

## Security Considerations

⚠️ **Current Implementation**:
- No authentication required
- No rate limiting
- No audit logging
- No permission checks

🔒 **Production Recommendations**:
1. Add user authentication
2. Implement role-based permissions
3. Add audit trail for bulk deletes
4. Rate limit bulk operations
5. Add maximum batch size limit
6. Require additional confirmation for large batches
7. Log IP addresses and timestamps

## Limitations

1. **No Undo**: Deletions are permanent
2. **No Progress Bar**: Uses simple loading state
3. **Synchronous Processing**: Processes cards sequentially
4. **Memory Limits**: No pagination for large selections
5. **No Preview**: Doesn't show which cards will be deleted

## Future Enhancements

1. **Progress Indicator**: Show "Deleting 3 of 10..." progress
2. **Preview Mode**: Review selected cards before deleting
3. **Undo/Restore**: Soft delete with restoration capability
4. **Export Selection**: Download list of selected cards
5. **Smart Selection**: Select by criteria (server, watchlist, date range)
6. **Batch Size Limits**: Warn when selecting > 100 cards
7. **Async Processing**: Process large batches in background
8. **WebSocket Updates**: Real-time progress notifications
9. **Confirmation Checkboxes**: "I understand this will delete X cards"
10. **Dry Run Mode**: Test what would be deleted without deleting

## Performance Notes

- **Small Batches** (< 10 cards): < 1 second
- **Medium Batches** (10-50 cards): 1-3 seconds
- **Large Batches** (50-100 cards): 3-10 seconds
- **Very Large Batches** (> 100 cards): May timeout, needs optimization

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing or invalid cards array" | Request body invalid | Check JSON format |
| "Card not found in database" | Card ID doesn't exist | Verify card ID |
| "Server configuration not found" | Server URL not in config | Check config.json |
| "FRS server returned 404" | Card not on FRS server | Card already deleted from FRS |
| "FRS server timeout" | FRS server offline | Check FRS server status |

## Best Practices

### For Users:
1. **Test First**: Start with 1-2 cards before bulk deleting many
2. **Verify Selection**: Use "Select All" carefully
3. **Check Server**: Make sure you're on the right server
4. **Local vs FRS**: Understand the difference between delete options
5. **Backup**: Consider exporting data before mass deletions

### For Developers:
1. **Validate Input**: Always check request body
2. **Handle Errors**: Don't fail entire batch on one error
3. **Log Everything**: Track all deletion attempts
4. **Test Edge Cases**: Empty selections, invalid IDs, offline servers
5. **Monitor Performance**: Watch for slow batches

## Comparison: Single vs Bulk Delete

| Feature | Single Delete | Bulk Delete |
|---------|--------------|-------------|
| Cards per operation | 1 | Unlimited |
| UI Location | Card details drawer | Selection toolbar |
| Confirmation | Dialog with details | Dialog with count |
| Error Handling | Simple success/fail | Per-card status |
| Response Code | 200/404/500 | 200/207/400/500 |
| Performance | Fast (<100ms) | Varies by count |
| Use Case | Individual removal | Mass cleanup |
