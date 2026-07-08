# Multi-Select Bulk Delete - User Guide

## Quick Start

### Deleting Multiple Cards

**Option 1: From Server View**
1. Go to any server dashboard (e.g., click on a server card)
2. Click **"Select"** button in top-right corner
3. Click on cards you want to delete (they'll show a blue border)
4. Click **"Delete Local"** or **"Delete from FRS"**
5. Confirm in the dialog
6. Done! Cards are deleted

**Option 2: From Global Dashboard**
1. Stay on the home page (shows all cards from all servers)
2. Click **"Select"** button in top-right corner
3. Select cards from any server
4. Click **"Delete Local"** or **"Delete from FRS"**
5. Confirm and done!

## Visual Guide

### Step 1: Enter Selection Mode
```
┌────────────────────────────────────────────┐
│  OptiExacta | FRS Dashboard    [Select] ✓ │  ← Click here
└────────────────────────────────────────────┘
```

### Step 2: Selection Toolbar Appears
```
┌────────────────────────────────────────────────────────┐
│  [0 selected] [Select All (15)] [Deselect All]       │
│                                                        │
│  [Delete Local (0)]  [Delete from FRS (0)]           │
└────────────────────────────────────────────────────────┘
```

### Step 3: Select Cards
Click on cards to select them:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ ☑️ Server-1  │  │ ☑️ Server-1  │  │   Server-2   │
│ ┏━━━━━━━━━┓  │  │ ┏━━━━━━━━━┓  │  │ ┌─────────┐  │
│ ┃  Image  ┃  │  │ ┃  Image  ┃  │  │ │  Image  │  │
│ ┗━━━━━━━━━┛  │  │ ┗━━━━━━━━━┛  │  │ └─────────┘  │
│  John Doe    │  │  Jane Smith  │  │  Bob Jones   │
│  ID: 123     │  │  ID: 124     │  │  ID: 125     │
└──────────────┘  └──────────────┘  └──────────────┘
   SELECTED         SELECTED         NOT SELECTED
   (Blue Ring)      (Blue Ring)      (Normal)
```

### Step 4: Toolbar Updates with Selection Count
```
┌────────────────────────────────────────────────────────┐
│  [2 selected] [Select All (15)] [Deselect All]       │
│                                                        │
│  [Delete Local (2)]  [Delete from FRS (2)]           │
└────────────────────────────────────────────────────────┘
              Numbers update automatically ↑
```

### Step 5: Choose Delete Option

**Option A: Delete Local (Orange Button)**
- Deletes from your local database only
- Cards remain on FRS server
- Will re-sync next time (come back)
- Use for temporary cleanup

**Option B: Delete from FRS (Red Button)**
- Deletes from FRS server first
- Then deletes from local database
- Permanent deletion
- Won't come back on sync

### Step 6: Confirmation Dialog
```
┌─────────────────────────────────────────────┐
│  ⚠️  Confirm Deletion                       │
├─────────────────────────────────────────────┤
│                                             │
│  Are you sure you want to delete 2 card(s)?│
│                                             │
│  This will delete from BOTH the FRS server │
│  and local database.                       │
│                                             │
│  This action cannot be undone!             │
│                                             │
│  [Cancel]              [Yes, Delete]       │
└─────────────────────────────────────────────┘
```

### Step 7: Results Dialog
```
┌─────────────────────────────────────────────┐
│  ✅ Bulk Delete Results                     │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ Local: 2 deleted, 0 failed             │
│  ✅ FRS: 2 deleted, 0 failed               │
│                                             │
│  [OK]                                       │
└─────────────────────────────────────────────┘
```

## Features

### Quick Actions

**Select All**
- Selects all cards currently visible
- Respects search filter
- Shows count: "Select All (15)"

**Deselect All**
- Clears all selections
- Returns to zero selected
- Button appears only when cards are selected

**Cancel (Top Right)**
- Exits selection mode
- Clears all selections
- Returns to normal view

### Selection Count Badge
```
[2 selected] ← Always shows current count
```

### Visual Feedback

| State | Appearance |
|-------|------------|
| Not Selected | Normal card, no border |
| Selected | Blue ring border, checkbox icon |
| Hover (not selected) | Light border highlight |
| Hover (selected) | Blue border glow |

## Understanding Delete Options

### 🟧 Delete Local (Orange Button)

**What it does:**
- ✅ Deletes from local SQLite database
- ✅ Deletes local image files
- ❌ Does NOT delete from FRS server

**What happens next:**
- Card disappears from dashboard immediately
- Next sync will re-download the card from FRS
- Card comes back automatically

**Use when:**
- Testing bulk operations
- Temporary cleanup
- Want to re-sync fresh data
- Removing duplicates locally

**Example:**
```
Before: 10 cards local, 10 cards on FRS
Delete Local: 5 cards
After: 5 cards local, 10 cards on FRS
Next Sync: Back to 10 cards local (re-downloaded)
```

### 🔴 Delete from FRS (Red Button)

**What it does:**
- ✅ Deletes from FRS server first
- ✅ Then deletes from local database
- ✅ Deletes local image files

**What happens next:**
- Card deleted from FRS server permanently
- Card disappears from dashboard immediately
- Next sync will NOT bring it back
- Permanent deletion

**Use when:**
- Permanently removing people
- Cleaning up FRS server
- Final deletion (no recovery)

**Example:**
```
Before: 10 cards local, 10 cards on FRS
Delete from FRS: 5 cards
After: 5 cards local, 5 cards on FRS
Next Sync: Still 5 cards (deleted ones don't return)
```

## Workflows

### Workflow 1: Cleanup Old Cards
**Goal**: Remove outdated cards permanently

1. Go to server dashboard
2. Click "Select"
3. Click on old/outdated cards
4. Click "Delete from FRS" (red button)
5. Confirm
6. ✅ Cards permanently removed

### Workflow 2: Remove Duplicates
**Goal**: Clean up duplicate entries

1. Go to global dashboard
2. Search for person name
3. Click "Select"
4. Select duplicate cards
5. Click "Delete Local" (keep one on FRS)
6. ✅ Duplicates removed locally

### Workflow 3: Mass Cleanup
**Goal**: Delete many cards at once

1. Go to server dashboard
2. Click "Select"
3. Click "Select All"
4. Review count (e.g., "15 selected")
5. Choose delete option
6. Confirm carefully
7. ✅ All cards deleted

### Workflow 4: Cross-Server Cleanup
**Goal**: Delete cards from multiple servers

1. Go to global dashboard
2. Click "Select"
3. Select cards from Server-1
4. Select cards from Server-2
5. Select cards from Server-3
6. Click "Delete from FRS"
7. ✅ Cards deleted from all servers

## Tips & Tricks

### 💡 Quick Selection
- **Ctrl/Cmd + Click**: Select multiple without exiting selection mode
- **Shift + Click**: (Future: Select range)
- **Search + Select All**: Select all matching search results

### 💡 Safety Tips
1. **Start Small**: Test with 1-2 cards first
2. **Double Check**: Verify selection count before deleting
3. **Use Local First**: Test with "Delete Local" before "Delete from FRS"
4. **Search First**: Use search to narrow down before selecting
5. **Read Confirmation**: Always read the confirmation dialog

### 💡 Performance Tips
1. **Small Batches**: Delete < 50 cards at a time for best performance
2. **Per-Server**: Bulk delete within one server is faster
3. **Wait for Completion**: Don't refresh during deletion

### 💡 Troubleshooting
**Cards not selecting?**
- Make sure you're in selection mode (blue "Cancel" button)
- Try clicking the checkbox directly
- Refresh page and try again

**Delete button greyed out?**
- No cards selected (select at least 1)
- Operation in progress (wait for completion)

**Cards come back after deletion?**
- You used "Delete Local" instead of "Delete from FRS"
- Auto-sync re-downloaded them
- Use "Delete from FRS" for permanent deletion

## Keyboard Shortcuts (Future)

| Key | Action |
|-----|--------|
| `S` | Toggle selection mode |
| `A` | Select all |
| `Escape` | Deselect all / Exit selection mode |
| `Delete` | Open delete menu |
| `Ctrl+A` | Select all visible |
| `Ctrl+D` | Deselect all |

## Common Scenarios

### Scenario 1: "I deleted cards but they came back"
**Cause**: You used "Delete Local" instead of "Delete from FRS"
**Solution**: Use "Delete from FRS" (red button) for permanent deletion

### Scenario 2: "I can't select any cards"
**Cause**: Not in selection mode
**Solution**: Click "Select" button in top-right corner

### Scenario 3: "How do I delete all cards from one server?"
**Solution**:
1. Go to that server's dashboard
2. Click "Select"
3. Click "Select All"
4. Click "Delete from FRS"
5. Confirm

### Scenario 4: "I want to delete cards from multiple servers"
**Solution**:
1. Go to global dashboard (home)
2. Click "Select"
3. Select cards from different servers
4. Click "Delete from FRS"
5. Confirm

### Scenario 5: "Partial deletion - some succeeded, some failed"
**Cause**: Some cards don't exist or FRS server offline
**Solution**: Results dialog shows which succeeded/failed
- Check failed cards in results
- Try again for failed cards
- Check FRS server connection

## Result Interpretation

### ✅ Full Success
```
✅ Local: 5 deleted, 0 failed
✅ FRS: 5 deleted, 0 failed
```
All cards deleted successfully from both local and FRS

### ⚠️ Partial Success (Local Only)
```
✅ Local: 4 deleted, 1 failed
❌ Failed: Card 123 - Card not found in database
```
Most succeeded, one not found in database

### ⚠️ Partial Success (FRS)
```
✅ Local: 5 deleted, 0 failed
✅ FRS: 3 deleted, 2 failed
❌ FRS Failed: Cards 124, 125 - FRS server returned 404
```
Local deletion succeeded, but some cards not on FRS server

### ❌ Complete Failure
```
✅ Local: 0 deleted, 5 failed
```
No cards deleted - check error messages

## Safety Checklist

Before bulk deleting:
- [ ] Verified correct server selected
- [ ] Reviewed selection count (not too many)
- [ ] Understand Local vs FRS delete difference
- [ ] Read confirmation dialog carefully
- [ ] Confirmed with stakeholders (if needed)
- [ ] Backup available (if critical data)

## FAQ

**Q: Can I undo a bulk delete?**
A: No, deletions are permanent. If you used "Delete Local", they'll resync. If you used "Delete from FRS", they're gone forever.

**Q: What's the maximum cards I can delete at once?**
A: No hard limit, but recommend < 50 for best performance. Large batches (100+) may be slow.

**Q: Do I need special permissions to bulk delete?**
A: Currently no authentication required. (Production should add role-based permissions)

**Q: What if FRS server is offline?**
A: Local deletion will succeed, FRS deletion will fail. Results show partial success.

**Q: Can I delete cards from different servers in one operation?**
A: Yes! Use the global dashboard to select cards from any server.

**Q: Will images be deleted too?**
A: Yes, local image files are automatically deleted with the card.

**Q: How long does bulk delete take?**
A: Small batches (< 10): < 1 second. Medium (10-50): 1-3 seconds. Large (50-100): 3-10 seconds.

## Support

If you encounter issues:
1. Check browser console for errors (F12)
2. Verify FRS server is online
3. Try smaller batch size
4. Contact system administrator
5. Check server logs

## Version History

- **v1.0** (Nov 2025): Initial multi-select bulk delete release
  - Selection mode
  - Bulk delete from local
  - Bulk delete from FRS
  - Results dialog with detailed status
