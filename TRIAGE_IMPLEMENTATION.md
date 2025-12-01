# Triage Transmission Implementation - Complete Code & Logic

## Overview
This document contains the complete implementation for transmitting triage data from patients to providers.

---

## 1. DATA FLOW

```
Patient Side:
1. User enters symptoms
2. DoctaService.runAITriage(symptoms) → generates triage result
3. Store in local state (setTriageResult)
4. POST /api/triage → save to database (appointments.metadata.triage)
5. Provider can see it immediately

Provider Side:
1. GET /api/triage/provider/appointments → fetch all appointments with triage
2. Display in dashboard
3. Provider visit page polls every 3 seconds for updates
```

---

## 2. PATIENT SIDE - Triage Submission

### File: `app/(dashboard)/patient/triage/page.js`

**Logic Flow:**
1. Fetch upcoming appointment on mount
2. User enters symptoms and clicks "Run AI Analysis"
3. Call `DoctaService.runAITriage(symptoms)` to get AI analysis
4. Store result in state immediately (for UI display)
5. If appointment exists, save to database via API
6. Show success/error toast

**Key Code:**
```javascript
const handleTriage = async () => {
  // 1. Validate symptoms
  if (!symptoms.trim()) return;
  
  // 2. Run AI triage
  const result = await DoctaService.runAITriage(symptoms);
  setTriageResult(result); // Store in state
  
  // 3. Save to database if appointment exists
  if (upcomingAppointment?.id) {
    const saveRes = await triageAPI.store(
      upcomingAppointment.id,
      symptoms,
      result
    );
    // Show success toast
  }
};
```

**Data Structure Sent to API:**
```javascript
{
  appointmentId: "uuid",
  symptoms: "string",
  triageResult: {
    severity: 1-5,
    soapDraft: "string",
    triageLevel: "URGENT" | "ROUTINE",
    suggestedSpecialty: "string",
    flags: ["string"],
    suggestedMeds: ["string"]
  }
}
```

---

## 3. API CLIENT

### File: `lib/api.js` (lines 254-263)

```javascript
export const triageAPI = {
  store: (appointmentId, symptoms, triageResult) => api.post('/triage', {
    appointmentId,
    symptoms,
    triageResult
  }),
  getForAppointment: (appointmentId) => api.get(`/triage/appointment/${appointmentId}`),
  getProviderAppointments: () => api.get('/triage/provider/appointments')
};
```

---

## 4. SERVER API ROUTE - Save Triage

### File: `server/routes/triage.js` (POST /)

**Logic:**
1. Authenticate user
2. Validate required fields (appointmentId, symptoms, triageResult)
3. Check if user owns the appointment as patient
4. Call `triageService.storeTriage()` to save to database
5. Verify save succeeded
6. Return success response

**Current Implementation:**
```javascript
router.post('/', authenticate, auditMiddleware('create', 'triage'), async (req, res) => {
  const { appointmentId, symptoms, triageResult } = req.body;
  
  // Validate
  if (!appointmentId || !symptoms || !triageResult) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  // Check appointment ownership
  const { rows } = await db.query(
    'SELECT patient_id, provider_id FROM appointments WHERE id = $1',
    [appointmentId]
  );
  
  if (rows[0].patient_id !== req.user.id) {
    return res.status(403).json({ 
      success: false, 
      error: 'Only the patient for this appointment can submit triage' 
    });
  }
  
  // Save to database
  const result = await triageService.storeTriage(
    req.user.id,
    appointmentId,
    symptoms,
    triageResult
  );
  
  res.status(201).json({ success: true, appointment: result });
});
```

---

## 5. DATABASE SERVICE - Store Triage

### File: `server/services/triageService.js` - `storeTriage()`

**Logic:**
1. Begin database transaction
2. Check if `metadata` column exists, create if not
3. Verify appointment exists and belongs to patient
4. Update appointment metadata with triage data
5. Commit transaction
6. Return updated appointment

**Current Implementation:**
```javascript
async storeTriage(patientId, appointmentId, symptoms, triageResult) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure metadata column exists
    const checkColumn = await client.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'appointments' AND column_name = 'metadata'`
    );
    if (checkColumn.rows.length === 0) {
      await client.query(`
        ALTER TABLE appointments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
      `);
    }
    
    // Verify appointment
    const appointmentCheck = await client.query(
      'SELECT id, patient_id FROM appointments WHERE id = $1',
      [appointmentId]
    );
    if (appointmentCheck.rows[0].patient_id !== patientId) {
      throw new Error('Appointment does not belong to this patient');
    }
    
    // Update appointment metadata
    const updateQuery = `
      UPDATE appointments
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'triage', jsonb_build_object(
          'severity', $1,
          'soapDraft', $2,
          'triageLevel', $3,
          'suggestedSpecialty', $4,
          'flags', $5::jsonb,
          'suggestedMeds', $6::jsonb,
          'symptoms', $7,
          'timestamp', CURRENT_TIMESTAMP
        )
      )
      WHERE id = $8
      RETURNING *
    `;
    
    const result = await client.query(updateQuery, [
      triageResult.severity,
      triageResult.soapDraft || '',
      triageResult.triageLevel || (triageResult.severity >= 4 ? 'URGENT' : 'ROUTINE'),
      triageResult.suggestedSpecialty || 'Primary Care',
      JSON.stringify(triageResult.flags || []),
      JSON.stringify(triageResult.suggestedMeds || []),
      symptoms,
      appointmentId
    ]);
    
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Database Structure:**
```sql
appointments.metadata = {
  "triage": {
    "severity": 4,
    "soapDraft": "SUBJECTIVE:\n...\nASSESSMENT:\n...\nPLAN:\n...",
    "triageLevel": "URGENT",
    "suggestedSpecialty": "Nephrology",
    "flags": ["RENAL FAILURE RISK"],
    "suggestedMeds": ["Lisinopril", "Prednisone"],
    "symptoms": "Swelling ankles, foamy urine, fatigue",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

---

## 6. SERVER API ROUTE - Get Provider Triage Cases

### File: `server/routes/triage.js` (GET /provider/appointments)

**Logic:**
1. Authenticate user (must be provider/admin)
2. Query database for appointments with triage data where provider_id matches
3. Return appointments with triage data

**Current Implementation:**
```javascript
router.get('/provider/appointments', authenticate, async (req, res) => {
  // Check role
  if (req.user.role !== 'provider' && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Only providers can access this' });
  }
  
  // Get appointments with triage
  const appointments = await triageService.getAppointmentsWithTriage(req.user.id);
  
  res.json({ success: true, appointments: appointments || [] });
});
```

---

## 7. DATABASE SERVICE - Get Provider Triage Cases

### File: `server/services/triageService.js` - `getAppointmentsWithTriage()`

**Logic:**
1. Check if metadata column exists
2. Query appointments where:
   - provider_id = providerId
   - metadata IS NOT NULL
   - metadata has 'triage' key
   - triage data is not null
3. Join with users table to get patient info
4. Filter and map results
5. Return appointments with triageData attached

**Current Implementation:**
```javascript
async getAppointmentsWithTriage(providerId) {
  // Check metadata column exists
  const checkColumn = await db.pool.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'appointments' AND column_name = 'metadata'`
  );
  if (checkColumn.rows.length === 0) return [];
  
  // Query appointments with triage
  const result = await db.pool.query(
    `SELECT a.*,
            p.first_name as patient_first_name,
            p.last_name as patient_last_name,
            p.email as patient_email,
            p.phone as patient_phone,
            p.date_of_birth as patient_dob,
            a.metadata->'triage' as triage_data
     FROM appointments a
     JOIN users p ON p.id = a.patient_id
     WHERE a.provider_id = $1
     AND a.metadata IS NOT NULL
     AND a.metadata ? 'triage'
     AND (a.metadata->'triage') IS NOT NULL
     AND (a.metadata->'triage')::text != 'null'
     ORDER BY COALESCE((a.metadata->'triage'->>'severity')::int, 0) DESC, a.scheduled_at ASC`,
    [providerId]
  );
  
  // Filter and map
  return result.rows
    .filter(row => row.triage_data && typeof row.triage_data === 'object')
    .map(row => {
      const appointment = keysToCamel(row);
      appointment.triageData = row.triage_data;
      return appointment;
    });
}
```

---

## 8. PROVIDER SIDE - Triage Dashboard

### File: `app/(dashboard)/provider/triage/page.js`

**Logic:**
1. On mount, fetch triage cases
2. Set up 30-second auto-refresh interval
3. Calculate stats (total, urgent, routine, avg severity)
4. Display cases in cards
5. Allow clicking to view details

**Current Implementation:**
```javascript
const fetchTriageCases = async () => {
  const response = await api.get('/triage/provider/appointments');
  if (response?.data?.success) {
    const cases = response.data.appointments || [];
    setTriageCases(cases);
    
    // Calculate stats
    const urgent = cases.filter(c => 
      c?.triageData?.triageLevel === 'URGENT' || c?.triageData?.severity >= 4
    ).length;
    // ... set stats
  }
};

useEffect(() => {
  fetchTriageCases();
  const interval = setInterval(fetchTriageCases, 30000);
  return () => clearInterval(interval);
}, []);
```

---

## 9. PROVIDER VISIT PAGE - Real-time Triage Display

### File: `app/(dashboard)/provider/appointments/[id]/visit/page.js`

**Logic:**
1. Fetch appointment data (includes metadata.triage)
2. Poll every 3 seconds for triage updates
3. Display AI Assessment in sidebar
4. Show AI Smart Suggestions in ePrescribe component

**Key Code:**
```javascript
// Poll for triage updates
useEffect(() => {
  const fetchTriageData = async () => {
    const triageRes = await api.get(`/triage/appointment/${appointmentId}`);
    if (triageRes.data?.success && triageRes.data.triage) {
      setAppointment(prev => ({
        ...prev,
        triageData: triageRes.data.triage
      }));
    }
  };
  
  fetchTriageData();
  const interval = setInterval(fetchTriageData, 3000);
  return () => clearInterval(interval);
}, [appointmentId]);

// Display in sidebar
{appointment.triageData && (
  <div>
    <p>AI Assessment</p>
    <p>{appointment.triageData.suggestedSpecialty}</p>
    <p>{appointment.triageData.soapDraft}</p>
  </div>
)}

// Pass to ePrescribe component
<ePrescribe aiSuggestions={appointment?.triageData?.suggestedMeds || []} />
```

---

## 10. POTENTIAL ISSUES & DEBUGGING

### Issue 1: Triage Not Saving
**Symptoms:** Patient sees success but provider sees nothing
**Debug:**
- Check server logs for `Triage saved successfully`
- Verify appointment ownership check passes
- Check database: `SELECT metadata->'triage' FROM appointments WHERE id = 'appointment-id'`

### Issue 2: Provider Not Seeing Triage
**Symptoms:** Triage saved but dashboard shows 0 cases
**Debug:**
- Check server logs: `Total triage cases in system: X`
- Check server logs: `Provider IDs with triage: [...]`
- Verify provider_id in appointment matches logged-in provider
- Check query: `SELECT provider_id FROM appointments WHERE id = 'appointment-id'`

### Issue 3: Data Structure Mismatch
**Symptoms:** Triage saved but fields missing
**Debug:**
- Verify triageResult structure matches expected format
- Check JSON.stringify is working correctly for arrays
- Verify database JSONB structure

---

## 11. COMPLETE CODE FILES

### Patient Triage Page
**File:** `app/(dashboard)/patient/triage/page.js`
- Lines 48-149: handleTriage function
- Calls: DoctaService.runAITriage() → triageAPI.store()

### API Client
**File:** `lib/api.js`
- Lines 254-263: triageAPI object with store(), getForAppointment(), getProviderAppointments()

### Server Route - Save
**File:** `server/routes/triage.js`
- Lines 14-80: POST / - Save triage
- Validates appointment ownership
- Calls triageService.storeTriage()

### Server Route - Get Provider Cases
**File:** `server/routes/triage.js`
- Lines 99-176: GET /provider/appointments
- Returns all appointments with triage for provider

### Database Service
**File:** `server/services/triageService.js`
- Lines 14-98: storeTriage() - Saves to appointments.metadata.triage
- Lines 136-189: getAppointmentsWithTriage() - Queries by provider_id

### Provider Dashboard
**File:** `app/(dashboard)/provider/triage/page.js`
- Lines 56-123: fetchTriageCases() - Fetches and displays cases
- Auto-refreshes every 30 seconds

---

## 12. DATA FLOW DIAGRAM

```
┌─────────────────┐
│  Patient Page   │
│                 │
│ 1. Enter        │
│    symptoms     │
│                 │
│ 2. Run AI       │
│    Triage       │
│                 │
│ 3. Store in     │
│    state        │
│                 │
│ 4. POST /triage │──────────┐
└─────────────────┘          │
                        │
                        ▼
              ┌──────────────────┐
              │  Server Route    │
              │  POST /triage    │
              │                  │
              │ 1. Validate      │
              │ 2. Check owner   │
              │ 3. Save to DB    │
              └──────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Database        │
              │  appointments    │
              │  metadata.triage │
              └──────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Provider Query  │
              │  GET /provider/  │
              │  appointments    │
              └──────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Provider        │
              │  Dashboard       │
              │  Shows cases     │
              └──────────────────┘
```

---

## 13. KEY POINTS TO CHECK

1. **Appointment Ownership:** User must be patient_id for the appointment
2. **Provider ID Match:** provider_id in appointment must match logged-in provider
3. **Metadata Column:** Must exist in appointments table
4. **JSONB Structure:** Triage data stored as JSONB in metadata.triage
5. **Query Filters:** Multiple filters ensure only valid triage data is returned
6. **Auto-refresh:** Provider dashboard refreshes every 30 seconds
7. **Real-time Updates:** Provider visit page polls every 3 seconds

---

## 14. TESTING CHECKLIST

- [ ] Patient can submit triage with appointment
- [ ] Triage saves to database (check metadata column)
- [ ] Provider can see triage in dashboard
- [ ] Provider can see triage in visit page
- [ ] AI suggestions appear in ePrescribe
- [ ] Stats calculate correctly
- [ ] Auto-refresh works
- [ ] Error handling doesn't break UI

---

## END OF IMPLEMENTATION DOCUMENT

