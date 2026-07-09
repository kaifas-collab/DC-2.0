# Delete Card Feature

## Overview
Added the ability to delete individual cards from each server. The delete operation removes both the database entry and the associated local image files.

## Implementation Details

### 1. Database Service Update (`lib/dbService.ts`)
Added `deleteCard()` method:
```typescript
static deleteCard(serverUrl: string, cardId: string): boolean
```
- Takes server URL and card ID as parameters
- Returns `true` if card was found and deleted
- Uses composite key (server_url, card_id) for unique identification

### 2. API Endpoint (`app/api/cards/delete/route.ts`)
Created POST endpoint at `/api/cards/delete`:
- **Method**: POST
- **Request Body**: 
  ```json
  {
    "server_url": "http://172.203.130.108/",
    "card_id": "67"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Card deleted successfully",
    "deletedCard": {
      "server_url": "http://172.203.130.108/",
      "card_id": "67"
    }
  }
  ```

**Features:**
- Validates required parameters (server_url, card_id)
- Fetches card details before deletion to locate image files
- Deletes card from database
- Deletes associated local image files from `/public/uploads/`
- Returns appropriate error codes (400, 404, 500)
- Doesn't fail entire operation if image file deletion fails

### 3. UI Components

#### CardDetailsDrawer (`components/_comps/CardDetailsDrawer.tsx`)
Updated to support delete functionality:
- Changed from `CardData` to `UnifiedCardData` type
- Added `onDelete` callback prop
- Added delete confirmation UI
- Features:
  - **Delete Button**: Red button with trash icon
  - **Confirmation Dialog**: Shows warning before deletion
  - **Loading State**: Shows spinner during deletion
  - **Auto-close**: Closes drawer after successful deletion
  - **Error Handling**: Shows alert on failure

**Delete Flow:**
1. User clicks "Delete Card" button
2. Confirmation dialog appears with warning message
3. User confirms deletion
4. API call to `/api/cards/delete`
5. On success: Calls parent's `onDelete()` callback and closes drawer
6. On error: Shows error alert

#### ServerDashboard (`components/_comps/ServerDashboard.tsx`)
Updated to support card deletion:
- Added `rawCards` state to store full `UnifiedCardData`
- Added `handleCardClick()` to map CardData to UnifiedCardData
- Added `handleDeleteCard()` callback to reload cards after deletion
- Passes `onDelete` callback to CardDetailsDrawer

## Testing

### Manual Test
```bash
# 1. Check current card count
curl -s http://localhost:3000/api/cards | jq '.data | length'
# Output: 15

# 2. Get card details to delete
curl -s http://localhost:3000/api/cards | jq '.data[0] | {server_url, card_id, name}'
# Output: {"server_url":"http://172.203.130.108/","card_id":"67","name":"test1"}

# 3. Delete the card
curl -X POST http://localhost:3000/api/cards/delete \
  -H "Content-Type: application/json" \
  -d '{"server_url":"http://172.203.130.108/","card_id":"67"}' | jq .
# Output: {"success":true,"message":"Card deleted successfully",...}

# 4. Verify card count decreased
curl -s http://localhost:3000/api/cards | jq '.data | length'
# Output: 14

# 5. Verify image file was deleted
ls -lh public/uploads/test1-67.jpg
# Output: No such file or directory
```

### UI Test
1. Navigate to server dashboard: http://localhost:3000/server?ip=172.203.130.108
2. Click on any card to open details drawer
3. Scroll to bottom and click "Delete Card" button
4. Confirm deletion in the dialog
5. Verify:
   - Card is removed from the grid
   - Drawer closes automatically
   - Card count updates

## Error Handling

### API Errors
- **400 Bad Request**: Missing server_url or card_id
- **404 Not Found**: Card doesn't exist in database
- **500 Internal Server Error**: Database or file system error

### UI Error Handling
- Shows browser alert with error message
- Keeps drawer open on error
- Resets loading state
- Hides confirmation dialog on error

### File Deletion
- Image deletion failure doesn't block card deletion
- Logs error to console but returns success
- Prevents orphaned database records

## File Changes Summary

### Modified Files:
1. `lib/dbService.ts` - Added deleteCard() method
2. `app/api/cards/delete/route.ts` - New delete endpoint
3. `components/_comps/CardDetailsDrawer.tsx` - Added delete UI and logic
4. `components/_comps/ServerDashboard.tsx` - Added delete callback handling

### Type Changes:
- CardDetailsDrawer now uses `UnifiedCardData` instead of `CardData`
- Added `onDelete?: () => void` prop to CardDetailsDrawer interface

## Security Considerations

1. **No Authentication**: Currently no auth on delete endpoint (add if needed)
2. **Server-side Validation**: Validates all inputs before deletion
3. **Cascade Delete**: Automatically removes associated image files
4. **File System Safety**: Uses path.join() to prevent directory traversal
5. **Error Leakage**: Generic error messages returned to client

## Future Enhancements

1. **Bulk Delete**: Add ability to delete multiple cards at once
2. **Soft Delete**: Add ability to mark cards as deleted without removing
3. **Undo Feature**: Add ability to restore recently deleted cards
4. **Audit Log**: Track who deleted what and when
5. **Authentication**: Add user authentication before allowing deletes
6. **Permissions**: Add role-based permissions for delete operations
7. **Confirmation Dialog**: Add checkbox "I understand this is permanent"
8. **FRS Server Sync**: Option to also delete from FRS server (if API supports)

## Notes

- Delete is permanent and cannot be undone
- Only deletes from local database, not from FRS server
- Image files in `/public/uploads/` are also removed
- Card count in dashboard updates after deletion
- Works with local image storage system
