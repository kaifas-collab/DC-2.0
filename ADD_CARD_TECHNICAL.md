# Add Card Feature - Technical Documentation

## Architecture Overview

The Add Card feature enables users to create new facial recognition cards across multiple FRS servers simultaneously. The implementation follows a client-server architecture with multi-server orchestration.

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface (React)                    │
│                  AddCardDialog Component                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓ Form Submit (multipart/form-data)
        ┌────────────────────────┐
        │   /api/cards/add       │
        │   (Next.js API Route)  │
        └────────┬───────────────┘
                 │
                 ↓ Parallel Requests
┌────────────────┼────────────────┬────────────────┐
│                │                │                │
▼                ▼                ▼                ▼
[FRS Server 1]  [FRS Server 2]  [FRS Server 3]  ...
│                │                │                │
│ POST /cards/   │ POST /cards/   │ POST /cards/   │
│ POST /faces/   │ POST /faces/   │ POST /faces/   │
│                │                │                │
└────────────────┴────────────────┴────────────────┘
                 │
                 ↓ Results Aggregation
        ┌────────────────────────┐
        │   Response to Client   │
        │   (Success/Partial/    │
        │    Error)              │
        └────────────────────────┘
                 │
                 ↓ Trigger Sync
        ┌────────────────────────┐
        │   /api/sync            │
        │   (Database Update)    │
        └────────────────────────┘
```

## Components

### 1. AddCardDialog Component (`components/_comps/AddCardDialog.tsx`)

#### Props
```typescript
interface AddCardDialogProps {
  isOpen: boolean          // Controls dialog visibility
  onClose: () => void     // Callback when dialog is closed
  onSuccess: () => void   // Callback after successful card creation
}
```

#### State Management
```typescript
const [name, setName] = useState<string>("")
const [photo, setPhoto] = useState<File | null>(null)
const [photoPreview, setPhotoPreview] = useState<string | null>(null)
const [selectedWatchlists, setSelectedWatchlists] = useState<number[]>([])
const [selectedServers, setSelectedServers] = useState<string[]>([])
const [watchlists, setWatchlists] = useState<Watchlist[]>([])
const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
const [submitStatus, setSubmitStatus] = useState<StatusObject>({...})
```

#### Key Functions

**loadWatchlists(serverName: string)**
- Fetches watchlists from specified server
- Called when dialog opens
- Populates dropdown with available watchlists

**handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>)**
- Handles file input change
- Creates preview using FileReader API
- Validates file type and size

**toggleWatchlist(watchlistId: number)**
- Adds/removes watchlist from selection
- Updates selectedWatchlists array

**toggleServer(serverName: string)**
- Adds/removes server from selection
- Updates selectedServers array

**selectAllServers()**
- Toggles all servers on/off
- Convenience function for bulk selection

**handleSubmit(e: React.FormEvent)**
- Validates form inputs
- Creates FormData object
- Sends POST request to `/api/cards/add`
- Handles response and updates UI

#### Form Validation
```typescript
// Name validation
if (!name.trim()) {
  setSubmitStatus({ type: 'error', message: 'Please enter a name' })
  return
}

// Server validation
if (selectedServers.length === 0) {
  setSubmitStatus({ type: 'error', message: 'Please select at least one server' })
  return
}
```

### 2. API Route: `/api/cards/add/route.ts`

#### Request Format
```typescript
POST /api/cards/add
Content-Type: multipart/form-data

Fields:
  - name: string (required)
  - watchlists: JSON string array of numbers
  - servers: JSON string array of server names
  - photo: File (optional)
```

#### Processing Flow

**Step 1: Parse Request**
```typescript
const formData = await request.formData()
const name = formData.get('name') as string
const watchlists = JSON.parse(formData.get('watchlists') as string)
const servers = JSON.parse(formData.get('servers') as string)
const photo = formData.get('photo') as File
```

**Step 2: Validate Input**
```typescript
if (!name || !watchlists || !servers) {
  return NextResponse.json({ error: 'Required fields missing' }, { status: 400 })
}

if (servers.length === 0) {
  return NextResponse.json({ error: 'No servers selected' }, { status: 400 })
}
```

**Step 3: Process Each Server**
```typescript
const results = await Promise.allSettled(
  serverNames.map(async (serverName) => {
    // Find server config
    const server = CONFIG.servers.find(s => s.name === serverName)
    
    // Step 3a: Create card
    const cardResponse = await axios.post(createCardUrl, cardData, {...})
    const cardId = cardResponse.data.id
    
    // Step 3b: Upload photo (if provided)
    if (photo && photo.size > 0) {
      await axios.post(uploadUrl, imageFormData, {...})
    }
    
    return { server, cardId, photoUploaded }
  })
)
```

**Step 4: Analyze Results**
```typescript
const successful = results.filter(r => r.status === 'fulfilled')
const failed = results.filter(r => r.status === 'rejected')

// Return appropriate HTTP status
if (successful.length === 0) return 500
if (failed.length > 0) return 207  // Multi-Status
return 200
```

#### Response Format

**Complete Success (HTTP 200)**
```json
{
  "success": true,
  "message": "Card \"John Doe\" added successfully to 3 server(s)",
  "results": {
    "successful": [
      {
        "server": "FRS-Server-1",
        "cardId": 12345,
        "photoUploaded": true,
        "success": true
      }
    ],
    "failed": [],
    "total": 3,
    "successCount": 3,
    "failCount": 0
  }
}
```

**Partial Success (HTTP 207)**
```json
{
  "success": true,
  "message": "Card added to 2 of 3 servers",
  "results": {
    "successful": [...],
    "failed": [
      {
        "server": "Unknown",
        "error": "Server FRS-Server-3 not found in configuration"
      }
    ],
    "total": 3,
    "successCount": 2,
    "failCount": 1
  }
}
```

**Complete Failure (HTTP 500)**
```json
{
  "success": false,
  "error": "Failed to add card to any server",
  "details": [...]
}
```

### 3. Watchlists API Route: `/api/watchlists/route.ts`

#### Request Format
```
GET /api/watchlists?server={serverName}
```

#### Processing
1. Validate server parameter
2. Find server in configuration
3. Fetch watchlists from FRS server with pagination
4. Return formatted watchlist data

#### Response Format
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Employees",
      "description": "Company employees"
    },
    {
      "id": 2,
      "name": "VIP",
      "description": "Important persons"
    }
  ],
  "count": 2
}
```

## FRS API Integration

### Create Card Endpoint

**Request**
```http
POST http://{server_ip}/cards/humans/
Accept: application/json
Authorization: Token {token}
Content-Type: application/json

{
  "active": true,
  "name": "John Doe",
  "comment": "",
  "watch_lists": [1, 2]
}
```

**Response**
```json
{
  "id": 12345,
  "name": "John Doe",
  "active": true,
  "watch_lists": [1, 2],
  "created_date": "2025-12-01T10:00:00Z",
  ...
}
```

### Upload Face Photo Endpoint

**Request**
```http
POST http://{server_ip}/objects/faces/
Accept: application/json
Authorization: Token {token}
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="source_photo"; filename="photo.jpg"
Content-Type: image/jpeg

{binary image data}
--boundary
Content-Disposition: form-data; name="card"

12345
--boundary--
```

**Response**
```json
{
  "id": 67890,
  "card": 12345,
  "thumbnail": "/media/faces/...",
  "source_photo": "/media/sources/...",
  "created_date": "2025-12-01T10:00:05Z",
  ...
}
```

### Get Watchlists Endpoint

**Request**
```http
GET http://{server_ip}/watch-lists/
Accept: application/json
Authorization: Token {token}
```

**Response**
```json
{
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 1,
      "name": "Employees",
      "description": "All company employees",
      ...
    }
  ]
}
```

## Error Handling

### Client-Side Errors

**Form Validation Errors**
- Empty name field
- No servers selected
- Invalid photo format/size

**Network Errors**
- Timeout during submission
- Server unavailable
- Network connectivity issues

**FRS API Errors**
- Invalid token
- Card creation failed
- Photo upload failed

### Server-Side Errors

**Configuration Errors**
```typescript
if (!server) {
  throw new Error(`Server ${serverName} not found in configuration`)
}
```

**FRS API Errors**
```typescript
try {
  const response = await axios.post(...)
} catch (error) {
  console.error(`Error adding card to ${serverName}:`, error)
  throw error
}
```

**Partial Failures**
- Using `Promise.allSettled()` ensures all servers are processed
- Individual failures don't prevent others from succeeding
- Detailed error reporting per server

## Performance Considerations

### Parallel Processing
```typescript
// All servers processed in parallel, not sequentially
const results = await Promise.allSettled(
  serverNames.map(async (serverName) => {
    // Process this server
  })
)
```

**Benefits:**
- Fast execution (3 servers in ~5s vs ~15s sequential)
- Independent operations
- Better user experience

### Timeout Configuration
```typescript
// Card creation: 15 seconds
axios.post(createCardUrl, cardData, { timeout: 15000 })

// Photo upload: 30 seconds (larger payload)
axios.post(uploadUrl, imageFormData, { timeout: 30000 })

// Overall form submission: 60 seconds
axios.post('/api/cards/add', formData, { timeout: 60000 })
```

### Image Optimization
- Client-side preview using FileReader
- No image processing (sent as-is to FRS)
- Size limit enforced (10MB)

## Security Considerations

### Current Implementation

**Authentication**: ❌ None
- No user authentication required
- Anyone can add cards

**Authorization**: ❌ None
- No role-based access control
- No permission checks

**Input Validation**: ✅ Basic
- Name required
- Server selection validated
- File type checking (client-side)

**API Security**: ✅ Token-based
- Each FRS server requires valid token
- Tokens stored in server configuration
- Tokens sent via Authorization header

### Production Recommendations

1. **Add User Authentication**
```typescript
// Verify user is logged in
const session = await getSession(request)
if (!session) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

2. **Implement RBAC**
```typescript
// Check user has permission to add cards
if (!session.user.permissions.includes('cards:create')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

3. **Add Audit Logging**
```typescript
// Log card creation
await auditLog.create({
  user: session.user.id,
  action: 'card_created',
  details: { name, servers, cardIds },
  timestamp: new Date()
})
```

4. **Rate Limiting**
```typescript
// Limit to 10 card creations per hour
const rateLimit = await checkRateLimit(session.user.id, 'card_create', 10, 3600)
if (!rateLimit.allowed) {
  return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
}
```

5. **Input Sanitization**
```typescript
// Sanitize name input
const sanitizedName = sanitize(name)
const validatedName = validateName(sanitizedName)
```

## Testing

### Unit Tests

**Component Tests**
```typescript
describe('AddCardDialog', () => {
  it('should validate required fields', () => {
    // Test empty name
    // Test no servers selected
  })
  
  it('should handle photo upload', () => {
    // Test file selection
    // Test preview generation
    // Test remove photo
  })
  
  it('should manage watchlist selection', () => {
    // Test toggle single
    // Test multiple selection
  })
})
```

**API Tests**
```typescript
describe('POST /api/cards/add', () => {
  it('should create card on single server', async () => {
    const formData = new FormData()
    formData.append('name', 'Test User')
    formData.append('servers', JSON.stringify(['FRS-Server-1']))
    
    const response = await POST(formData)
    expect(response.status).toBe(200)
  })
  
  it('should handle partial failures', async () => {
    // Mock one server failing
    // Expect HTTP 207
  })
})
```

### Integration Tests

**End-to-End Flow**
1. Open dialog
2. Fill form
3. Select servers
4. Submit
5. Verify card created on FRS
6. Verify database sync
7. Verify card appears in dashboard

### Manual Testing Checklist

- [ ] Dialog opens/closes correctly
- [ ] Name field validation works
- [ ] Photo upload shows preview
- [ ] Photo removal works
- [ ] Watchlists load from server
- [ ] Multiple watchlist selection works
- [ ] Server selection toggles work
- [ ] Select All servers works
- [ ] Form submission with all fields
- [ ] Form submission without photo
- [ ] Form submission without watchlists
- [ ] Error messages display correctly
- [ ] Success message displays correctly
- [ ] Partial success handling
- [ ] Complete failure handling
- [ ] Database sync triggered
- [ ] New card appears in dashboard

## Monitoring & Logging

### Console Logging

```typescript
// Success
console.log(`✅ Card created on ${serverName} with ID: ${cardId}`)
console.log(`✅ Photo uploaded to ${serverName} for card ${cardId}`)

// Warnings
console.warn(`⚠️ Photo upload failed for ${serverName}:`, error)

// Errors
console.error(`❌ Error adding card to ${serverName}:`, error)
```

### Metrics to Track

- Cards created per day
- Success rate per server
- Photo upload success rate
- Average processing time
- Most used watchlists
- Most selected servers
- Error rates by type

## Future Enhancements

1. **Bulk Import**
   - CSV file upload
   - Multiple cards at once
   - Progress tracking

2. **Photo Enhancements**
   - Webcam capture
   - Image cropping
   - Auto-face detection
   - Quality validation

3. **Advanced Features**
   - Card templates
   - Duplicate detection
   - Auto-watchlist assignment
   - Scheduled additions

4. **UI Improvements**
   - Per-server progress indicators
   - Real-time status updates
   - Drag-and-drop photos
   - Preview before submit

## Troubleshooting

### Common Issues

**Watchlists not loading**
- Check server connectivity
- Verify API token
- Check console for errors

**Photo upload fails**
- Check file size (< 10MB)
- Verify file format (JPG/PNG)
- Check FRS server storage

**Card created but not visible**
- Wait for database sync (auto-triggered)
- Click "Force Refresh"
- Check server selection

**Partial success**
- Normal behavior with multiple servers
- Review error details
- Retry on failed servers

## API Reference Summary

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/cards/add` | POST | Create card(s) | None |
| `/api/watchlists` | GET | Get watchlists | None |
| `/api/sync` | POST | Trigger DB sync | None |

## Configuration

Required in `config/config.json`:
```json
{
  "servers": [
    {
      "name": "FRS-Server-1",
      "baseURL": "http://172.203.130.108/",
      "token": "your_token_here",
      "location": "Location 1"
    }
  ],
  "apiEndpoints": {
    "cards": "cards/humans/",
    "faces": "objects/faces/",
    "watchlists": "/watch-lists/"
  }
}
```
