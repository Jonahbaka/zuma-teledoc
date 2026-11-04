# Patient Appointments - Complete Code & Implementation Review

## PROBLEM STATEMENT
**Provider portal shows 3 appointments for "Jonah Baka"**
**Patient portal shows 0 appointments for the same user**

---

## 1. SERVER ROUTE: GET /api/appointments

**File:** `server/routes/appointments.js` (lines 189-494)

### Complete Implementation:

```javascript
router.get('/', authenticate, async (req, res) => {
  try {
    const filters = validate(searchAppointmentsSchema, req.query);
    const { page, limit, sortBy, sortOrder } = parseQueryParams(filters);
    
    // Build query based on user role (case-insensitive check)
    let whereClause = '';
    const values = [];
    let paramIndex = 1;
    const userRole = String(req.user.role || '').toLowerCase().trim();
    
    if (userRole === 'patient') {
      // CRITICAL: Use string comparison to handle UUID/string mismatches
      const patientIdParam = String(req.user.id);
      whereClause = `WHERE a.patient_id::text = $${paramIndex}::text`;
      values.push(patientIdParam);
      paramIndex++;
      
      // Debug queries (3 different formats)
      const { rows: debugRows1 } = await db.query(
        'SELECT id, patient_id, provider_id, status, scheduled_at FROM appointments WHERE patient_id = $1 LIMIT 5',
        [req.user.id]
      );
      
      const { rows: debugRows2 } = await db.query(
        'SELECT id, patient_id, provider_id, status, scheduled_at FROM appointments WHERE patient_id::text = $1::text LIMIT 5',
        [patientIdParam]
      );
      
      const { rows: debugRows3 } = await db.query(
        'SELECT id, patient_id, provider_id, status, scheduled_at FROM appointments WHERE patient_id::uuid = $1::uuid LIMIT 5',
        [req.user.id]
      );
      
      logger.info('Patient appointments query debug', {
        userId: req.user.id,
        userIdString: patientIdParam,
        exactMatch: debugRows1.length,
        textMatch: debugRows2.length,
        uuidMatch: debugRows3.length
      });
    } else if (userRole === 'provider') {
      whereClause = `WHERE a.provider_id = $${paramIndex}`;
      values.push(req.user.id);
      paramIndex++;
    }
    
    // Add filters
    if (filters.status) {
      whereClause += ` AND a.status = $${paramIndex}`;
      values.push(filters.status);
      paramIndex++;
    }
    
    // Get total count - REBUILDS WHERE clause for patients
    let countWhereClause = whereClause;
    let countValues = [...values];
    
    if (userRole === 'patient') {
      countWhereClause = `WHERE a.patient_id::text = $1::text`;
      countValues = [String(req.user.id)];
      let countParamIndex = 2;
      
      if (filters.status) {
        countWhereClause += ` AND a.status = $${countParamIndex}`;
        countValues.push(filters.status);
        countParamIndex++;
      }
      // ... date filters ...
    }
    
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) as count FROM appointments a ${countWhereClause}`,
      countValues
    );
    const total = parseInt(countResult[0]?.count || 0);
    
    // Get appointments - REBUILDS WHERE clause AGAIN for patients
    const offset = (page - 1) * limit;
    let finalWhereClause = whereClause;
    let finalValues = [...values];
    let finalParamIndex = paramIndex;
    
    if (userRole === 'patient') {
      // REBUILD WHERE clause with text comparison
      finalWhereClause = `WHERE a.patient_id::text = $1::text`;
      finalValues = [String(req.user.id)];
      finalParamIndex = 2;
      
      // Add filters again
      if (filters.status) {
        finalWhereClause += ` AND a.status = $${finalParamIndex}`;
        finalValues.push(filters.status);
        finalParamIndex++;
      }
      // ... date filters ...
      
      finalValues.push(limit, offset);
    } else {
      finalValues.push(limit, offset);
    }
    
    const { rows } = await db.query(
      `SELECT a.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.specialty as provider_specialty,
              v.subjective as triage_subjective,
              v.assessment as triage_assessment
       FROM appointments a
       LEFT JOIN users p ON p.id = a.patient_id
       LEFT JOIN users pr ON pr.id = a.provider_id
       LEFT JOIN visits v ON v.appointment_id = a.id
       ${finalWhereClause}
       ORDER BY a.scheduled_at ${sortOrder}
       LIMIT $${finalParamIndex} OFFSET $${finalParamIndex + 1}`,
      finalValues
    );
    
    let appointments = rows.map(keysToCamel);
    // ... triage data extraction ...
    
    res.json({
      success: true,
      appointments,
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get appointments error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get appointments'
    });
  }
});
```

### ISSUE IDENTIFIED:
1. **WHERE clause rebuilt 3 times** for patients (initial, count, final)
2. **Parameter index resets** to 2 in final query, but LIMIT/OFFSET use `finalParamIndex + 1`
3. **Text casting** `::text` might be causing issues if database uses UUID type

---

## 2. SERVER ROUTE: POST /api/appointments/smart-book

**File:** `server/routes/appointments.js` (lines 549-820)

### Complete Implementation:

```javascript
router.post('/smart-book', authenticate, auditMiddleware('create', 'appointment'), async (req, res) => {
  try {
    const { category, specialties, scheduledAt, type, reasonForVisit, patientNotes, durationMinutes = 30, triageResult } = req.body;
    
    // CRITICAL: Use the authenticated user's ID as patient ID
    const patientId = req.user.id;
    
    // ... validation ...
    
    // Find provider
    // ... provider matching logic ...
    
    // Create the appointment
    const insertValues = [
      String(patientId), // Converted to string
      providerId,
      scheduledDate,
      durationMinutes,
      type || 'video',
      reasonForVisit,
      patientNotes || null,
      roomId,
      metadata ? JSON.stringify(metadata) : '{}'
    ];
    
    const { rows } = await db.query(
      `INSERT INTO appointments (
        patient_id, provider_id, scheduled_at, duration_minutes,
        type, reason_for_visit, patient_notes, room_id, status, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9::jsonb)
      RETURNING *`,
      insertValues
    );
    
    res.status(201).json({
      success: true,
      appointment: keysToCamel(rows[0]),
      provider: provider ? { ... } : null
    });
  } catch (error) {
    // ... error handling ...
  }
});
```

### ISSUE IDENTIFIED:
1. **String(patientId)** - Converting UUID to string before insert
2. **Database might store as UUID** - But we're inserting as string
3. **Query uses ::text** - But data stored might be UUID type

---

## 3. CLIENT: Patient Appointments Page

**File:** `app/(dashboard)/patient/appointments/page.js`

### Complete Implementation:

```javascript
export default function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchAppointments();
  }, [filter]);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter !== 'all') {
        params.status = filter;
      }
      
      const response = await appointmentsAPI.getAll(params);
      
      // Debug logging
      console.log('=== APPOINTMENTS API DEBUG ===');
      console.log('Response data:', response?.data);
      console.log('Appointments count:', response?.data?.appointments?.length || 0);
      
      // Extract appointments
      let appointmentsList = [];
      if (response?.data?.success && Array.isArray(response.data.appointments)) {
        appointmentsList = response.data.appointments;
      }
      
      setAppointments(appointmentsList);
    } catch (error) {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  // ... render code ...
}
```

### ISSUE IDENTIFIED:
- Client code looks correct
- Extracts `response.data.appointments` array
- Handles errors gracefully

---

## 4. API CLIENT

**File:** `lib/api.js` (lines 116-124)

```javascript
export const appointmentsAPI = {
  getAll: (params) => api.get('/appointments', { params }),
  // ... other methods
};
```

### ISSUE IDENTIFIED:
- Simple GET request with params
- Uses axios with auth interceptor
- Should work correctly

---

## 5. AUTHENTICATION MIDDLEWARE

**File:** `server/middleware/auth.js`

```javascript
const authenticate = async (req, res, next) => {
  // Get token from header/cookie
  // Verify JWT token
  // Get user from database
  const { rows } = await db.query(
    'SELECT id, email, role, ... FROM users WHERE id = $1',
    [decoded.userId]
  );
  
  req.user = {
    id: user.id,        // UUID from database
    email: user.email,
    role: user.role,
    // ...
  };
  
  next();
};
```

### ISSUE IDENTIFIED:
- `req.user.id` comes from database as UUID
- Type might be UUID object, not string

---

## 6. DATABASE SCHEMA (Expected)

```sql
CREATE TABLE appointments (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  scheduled_at TIMESTAMP,
  status VARCHAR(20),
  -- ...
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255),
  role VARCHAR(50),
  -- ...
);
```

---

## 7. ROOT CAUSE ANALYSIS

### Problem Flow:
1. **Appointment Created:**
   - `patientId = req.user.id` (UUID from database)
   - `String(patientId)` - Converted to string
   - Inserted as: `VALUES ($1, ...)` where $1 is string
   - **Database stores as UUID** (PostgreSQL auto-casts string to UUID)

2. **Appointment Query:**
   - `req.user.id` - UUID from database
   - `String(req.user.id)` - Converted to string
   - Query: `WHERE a.patient_id::text = $1::text`
   - **Both sides cast to text, should match**

3. **Why It Fails:**
   - **Parameter index issue**: `finalParamIndex` might be wrong
   - **WHERE clause rebuilding**: Filters added multiple times
   - **Type mismatch**: UUID vs string comparison failing silently

---

## 8. THE ACTUAL BUG

### Bug #1: Parameter Index Mismatch
```javascript
// Initial WHERE clause
whereClause = `WHERE a.patient_id::text = $1::text`;
values = [String(req.user.id)];  // $1

// Add status filter
whereClause += ` AND a.status = $2`;
values.push(filters.status);    // $2

// Rebuild for final query
finalWhereClause = `WHERE a.patient_id::text = $1::text`;  // RESETS to $1
finalValues = [String(req.user.id)];  // $1
finalParamIndex = 2;

if (filters.status) {
  finalWhereClause += ` AND a.status = $2`;  // Uses $2
  finalValues.push(filters.status);         // $2
  finalParamIndex++;  // Now 3
}

finalValues.push(limit, offset);  // $3, $4
// But query uses: LIMIT $${finalParamIndex} OFFSET $${finalParamIndex + 1}
// Which is: LIMIT $3 OFFSET $4
// But finalValues has: [patientId, status, limit, offset] = [$1, $2, $3, $4]
// THIS SHOULD WORK...

// UNLESS finalParamIndex is wrong!
```

### Bug #2: WHERE Clause Rebuilding
The WHERE clause is built 3 times:
1. Initial build (line 203)
2. Count query rebuild (line 286)
3. Final query rebuild (line 327)

Each rebuild resets parameter indices, which could cause mismatches.

### Bug #3: Text Casting Issue
Using `::text` on both sides should work, but if the database column is UUID type and we're comparing text, there might be whitespace or format differences.

---

## 9. EXPERT CORRECTION NEEDED

### Check These:
1. **Server logs** - What do the debug queries return?
   - `exactMatch`, `textMatch`, `uuidMatch` counts
   - What are the actual `patient_id` values in database?

2. **Database query** - Run directly:
   ```sql
   -- Get user ID
   SELECT id, email, role FROM users WHERE email = 'jonahbaka00@gmail.com';
   
   -- Check appointments with that user ID
   SELECT id, patient_id, provider_id, status 
   FROM appointments 
   WHERE patient_id = (SELECT id FROM users WHERE email = 'jonahbaka00@gmail.com');
   
   -- Try text comparison
   SELECT id, patient_id, provider_id, status 
   FROM appointments 
   WHERE patient_id::text = (SELECT id::text FROM users WHERE email = 'jonahbaka00@gmail.com');
   ```

3. **Parameter binding** - Check if `finalParamIndex` calculation is correct

4. **Type consistency** - Ensure `req.user.id` type matches `appointments.patient_id` type

---

## 10. RECOMMENDED FIX

### Option A: Use Direct UUID (Like Provider)
```javascript
if (userRole === 'patient') {
  whereClause = `WHERE a.patient_id = $${paramIndex}`;
  values.push(req.user.id);  // Don't convert to string
  paramIndex++;
}
// Don't rebuild - use same WHERE clause for count and final query
```

### Option B: Fix Parameter Index
```javascript
// Don't rebuild - use original whereClause and values
const { rows } = await db.query(
  `SELECT ... ${whereClause} ... LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
  [...values, limit, offset]
);
```

### Option C: Use Subquery
```javascript
if (userRole === 'patient') {
  whereClause = `WHERE a.patient_id = (SELECT id FROM users WHERE id = $${paramIndex})`;
  values.push(req.user.id);
  paramIndex++;
}
```

---

## END OF CODE REVIEW

**Key Files:**
- `server/routes/appointments.js` - Lines 189-494 (GET), 549-820 (POST)
- `app/(dashboard)/patient/appointments/page.js` - Complete file
- `lib/api.js` - Lines 116-124
- `server/middleware/auth.js` - Authentication setup

**Next Steps for Expert:**
1. Check server logs for debug query results
2. Run direct database queries to verify data
3. Check if `req.user.id` matches `appointments.patient_id`
4. Verify parameter index calculation
5. Test with simplified query (no text casting)

