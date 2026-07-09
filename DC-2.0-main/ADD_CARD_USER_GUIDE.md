# Add Card Feature - User Guide

## Overview
The Add Card feature allows you to create new facial recognition cards and add them to one or multiple FRS servers simultaneously. This is useful for enrolling new persons into the facial recognition system.

## Accessing the Feature

### From Homepage
1. Navigate to the homepage (`/`)
2. Click the **"Add Card"** button in the top right section

### From Unified Dashboard
1. Navigate to the dashboard (`/dashboard`)
2. Click the **"Add Card"** button in the header

## Adding a New Card

### Step 1: Open the Dialog
Click the "Add Card" button to open the card creation dialog.

### Step 2: Enter Required Information

#### Name (Required)
- Enter the person's full name
- This field is mandatory

#### Photo (Optional)
- Click "Choose Photo" or the upload area
- Select an image file (JPG, PNG, JPEG)
- Maximum file size: 10MB
- A preview will be shown after selection
- Click the X button to remove the photo

### Step 3: Select Watchlists (Optional)

#### Loading Watchlists
- Watchlists are automatically loaded from the first configured server
- A loading indicator will show while fetching

#### Selecting Watchlists
1. Click on the watchlists dropdown
2. Check the boxes next to the watchlists you want to add the card to
3. You can select multiple watchlists
4. Selected watchlists will appear as badges below the dropdown
5. Click the X on a badge to remove it from selection

**Note**: If no watchlists are selected, the card will be created but not added to any watchlists.

### Step 4: Select Target Servers (Required)

#### Select All Servers
- Click "Select All" to add the card to all configured servers
- Click "Deselect All" to clear all selections

#### Select Individual Servers
- Check the boxes next to specific servers
- Each server shows:
  - Server name
  - Server location
- Selected servers will be highlighted
- A count of selected servers is shown below

**Note**: At least one server must be selected.

### Step 5: Submit the Form

#### Before Submitting
Review your selections:
- ✅ Name is filled
- ✅ At least one server is selected
- ✅ Photo uploaded (if desired)
- ✅ Watchlists selected (if desired)

#### Click "Add Card"
- The button shows "Adding Card..." with a spinner during processing
- The process may take several seconds, especially when adding to multiple servers

## Results

### Success
- A green success message appears showing:
  - Number of servers the card was successfully added to
  - Card IDs for each server (if successful)
  - Whether the photo was uploaded (if applicable)
- The dialog automatically closes after 2 seconds
- The main page refreshes to show the new card

### Partial Success
- A yellow warning message appears showing:
  - Successfully added servers
  - Failed servers with error messages
- You can review which servers succeeded and which failed
- The card was created on successful servers only

### Error
- A red error message appears with details
- Common errors:
  - "Please enter a name" - Name field is empty
  - "Please select at least one server" - No servers selected
  - "Failed to add card" - Server communication error
- Fix the error and try again

## Technical Details

### API Workflow

#### Step 1: Create Card on FRS Server
For each selected server:
```bash
POST http://{server}/cards/humans/
{
  "active": true,
  "name": "Person Name",
  "comment": "",
  "watch_lists": [1, 2, 3]
}
```

**Response**: Card object with `id` field

#### Step 2: Upload Photo (if provided)
Using the card ID from Step 1:
```bash
POST http://{server}/objects/faces/
Content-Type: multipart/form-data

source_photo: {image file}
card: {card_id}
```

**Response**: Face object with upload confirmation

### Multi-Server Processing
- Cards are added to all selected servers in parallel
- Each server operation is independent
- Failures on one server don't affect others
- Results are aggregated and reported

### Database Sync
After successful card creation:
- A sync is automatically triggered
- The local database is updated
- New cards appear in the dashboard within seconds

## Best Practices

### Naming Convention
- Use full names for better searchability
- Be consistent with capitalization
- Include middle names or initials if needed
- Example: "John Michael Smith"

### Photo Guidelines
- Use clear, well-lit photos
- Face should be clearly visible
- Front-facing photos work best
- Avoid sunglasses or hats
- High-resolution images preferred
- Maximum size: 10MB

### Watchlist Selection
- Add to specific watchlists based on access requirements
- Example watchlists:
  - "Employees" - For regular staff
  - "VIP" - For important persons
  - "Visitors" - For temporary access
  - "Blacklist" - For denied access

### Server Selection

#### When to Use "Select All"
- Adding new employees across all locations
- Company-wide enrollments
- System-wide watchlist updates

#### When to Select Specific Servers
- Location-specific access
- Temporary visitors at one site
- Testing new enrollments
- Regional-only requirements

## Troubleshooting

### Watchlists Not Loading
**Problem**: Watchlist dropdown shows error or loading indefinitely

**Solutions**:
1. Check if at least one server is configured
2. Verify server connectivity
3. Ensure server API token is valid
4. Refresh the page and try again

### Photo Upload Fails
**Problem**: Card created but photo not uploaded

**Result**: Card appears with placeholder image

**Solutions**:
1. Check photo file size (must be < 10MB)
2. Verify photo format (JPG, PNG, JPEG only)
3. Ensure server has space for uploads
4. Try a different photo

### Card Not Appearing After Creation
**Problem**: Success message shown but card not in dashboard

**Solutions**:
1. Wait a few seconds for database sync
2. Click "Force Refresh" in the dashboard
3. Check if card was added to correct servers
4. Verify filters/search aren't hiding the card

### Partial Success
**Problem**: Card added to some servers but not others

**Explanation**: This is normal behavior. Servers operate independently.

**Action**:
1. Review the error details for failed servers
2. Fix the issues (connectivity, token, etc.)
3. Manually retry adding to failed servers only
4. Or accept partial success if some servers aren't critical

## Permissions & Security

### Current Implementation
⚠️ **No authentication required** - Anyone can add cards

### Production Recommendations
For production use, consider implementing:
1. User authentication and login
2. Role-based permissions (only admins can add cards)
3. Audit logging (track who added which cards)
4. Approval workflow (cards pending review)
5. Bulk import functionality
6. Data validation and sanitization

## API Endpoints

### Add Card
- **Endpoint**: `POST /api/cards/add`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `name` (string, required)
  - `watchlists` (JSON array of IDs)
  - `servers` (JSON array of server names)
  - `photo` (file, optional)

### Get Watchlists
- **Endpoint**: `GET /api/watchlists?server={serverName}`
- **Response**: List of watchlist objects with `id` and `name`

## Examples

### Example 1: Add Employee to All Servers
1. Click "Add Card"
2. Name: "Jane Doe"
3. Upload employee photo
4. Select watchlist: "Employees"
5. Click "Select All" for servers
6. Click "Add Card"

**Result**: Jane Doe added to all 3 servers with employee access

### Example 2: Add Visitor to Specific Location
1. Click "Add Card"
2. Name: "John Visitor"
3. Upload visitor photo
4. Select watchlist: "Visitors"
5. Select server: "FRS-Server-Basti" only
6. Click "Add Card"

**Result**: John Visitor added to Basti location only

### Example 3: Add to Multiple Watchlists
1. Click "Add Card"
2. Name: "Alice Admin"
3. Upload photo
4. Select watchlists: "Employees" AND "VIP"
5. Select all servers
6. Click "Add Card"

**Result**: Alice added to both watchlists on all servers

## Feature Limitations

1. **No bulk import** - Cards must be added one at a time
2. **No card editing** - Can't modify after creation (must delete and recreate)
3. **Photo size limit** - 10MB maximum
4. **Network dependent** - Requires connectivity to all selected servers
5. **No progress tracking** - Can't see which server is being processed
6. **No retry mechanism** - Must manually retry failed servers

## Future Enhancements

Potential improvements for future versions:
1. CSV import for bulk card creation
2. Edit existing card details
3. Progress bar showing per-server status
4. Automatic retry on failures
5. Template-based card creation
6. Duplicate detection before creation
7. Preview before submission
8. Drag-and-drop photo upload
9. Webcam integration for live photo capture
10. QR code generation for each card
