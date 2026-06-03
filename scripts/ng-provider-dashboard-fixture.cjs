#!/usr/bin/env node

const express = require('express');
const cors = require('cors');

const port = Number(process.env.NG_PROVIDER_DASHBOARD_FIXTURE_PORT || 8080);
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const provider = {
  id: 'ng-provider-dashboard-agent',
  email: 'ng.doctor.demo@doctarx.test',
  role: 'provider',
  firstName: 'Amina',
  lastName: 'Okafor',
  name: 'Dr. Amina Okafor',
  marketScope: 'NG',
  country: 'NG',
  mustChangePassword: false,
  accountStatus: 'active',
};

function authed(req, res, next) {
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

app.get('/api/health', (_, res) => {
  res.json({ success: true, service: 'ng-provider-dashboard-fixture' });
});

app.get('/api/auth/me', authed, (_, res) => {
  res.json({ success: true, user: provider });
});

app.post('/api/auth/login', (req, res) => {
  const { role } = req.body || {};
  if (role && role !== 'provider') {
    res.status(403).json({ success: false, error: 'Provider fixture only accepts provider logins' });
    return;
  }

  res.json({
    success: true,
    user: provider,
    accessToken: 'ng-provider-dashboard-token',
    refreshToken: 'ng-provider-dashboard-refresh-token',
  });
});

app.post('/api/auth/refresh', (_, res) => {
  res.json({
    success: true,
    accessToken: 'ng-provider-dashboard-token',
    refreshToken: 'ng-provider-dashboard-refresh-token',
  });
});

app.post('/api/auth/logout', (_, res) => {
  res.json({ success: true });
});

app.get('/api/appointments/upcoming', authed, (_, res) => {
  res.json({
    success: true,
    appointments: [
      {
        id: 'appt-malaria-review',
        patientFirstName: 'Chinedu',
        patientLastName: 'Bello',
        status: 'confirmed',
        scheduledAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        reasonForVisit: 'Fever, chills, malaria medication review',
      },
      {
        id: 'appt-hypertension-followup',
        patientFirstName: 'Ngozi',
        patientLastName: 'Eze',
        status: 'in_progress',
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        reasonForVisit: 'Hypertension follow-up and refill',
      },
    ],
  });
});

app.get('/api/visits/provider/recent', authed, (_, res) => {
  res.json({
    success: true,
    visits: [
      {
        id: 'visit-1',
        patientFirstName: 'Chinedu',
        patientLastName: 'Bello',
        status: 'signed',
        diagnosis: 'Uncomplicated malaria',
      },
    ],
  });
});

app.get('/api/ng/clinical/prescriptions', authed, (_, res) => {
  res.json({
    success: true,
    prescriptions: [
      {
        id: 'rx-1',
        patientFirstName: 'Chinedu',
        patientLastName: 'Bello',
        status: 'dispensed',
        medication_name: 'Artemether/Lumefantrine',
        refills_remaining: 0,
      },
      {
        id: 'rx-2',
        patientFirstName: 'Ngozi',
        patientLastName: 'Eze',
        status: 'sent',
        medication_name: 'Amlodipine',
        refills_remaining: 2,
      },
    ],
  });
});

app.get('/api/ng/clinical/referrals', authed, (_, res) => {
  res.json({
    success: true,
    referrals: [
      {
        id: 'ref-1',
        patient_first_name: 'Chinedu',
        patient_last_name: 'Bello',
        status: 'sent',
        priority: 'urgent',
        reason: 'Persistent fever after ACT',
      },
    ],
  });
});

app.get('/api/providers/me/patients', authed, (_, res) => {
  res.json({
    success: true,
    patients: [
      {
        id: 'patient-1',
        firstName: 'Chinedu',
        lastName: 'Bello',
        chronic_conditions: ['Hypertension'],
        medication_history: ['Artemether/Lumefantrine'],
      },
      {
        id: 'patient-2',
        firstName: 'Ngozi',
        lastName: 'Eze',
        chronic_conditions: ['Hypertension', 'Diabetes'],
        medication_history: ['Amlodipine'],
      },
    ],
  });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`provider dashboard fixture listening on ${port}`);
});
