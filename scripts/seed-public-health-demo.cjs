#!/usr/bin/env node

/**
 * Local-only Public Health Intelligence Programme demo seed.
 *
 * This creates aggregate public-health demo records only. It does not create
 * patient identifiers, clinical diagnoses, fake government IDs, fake live DHIS2
 * mappings, or production data.
 *
 * Run only in development/test:
 *   PUBLIC_HEALTH_DEMO_SEED=true NODE_ENV=development node scripts/seed-public-health-demo.cjs
 */

require('dotenv').config();

if (process.env.NODE_ENV === 'production' || process.env.PUBLIC_HEALTH_DEMO_SEED !== 'true') {
  console.error('Refusing to seed public-health demo data. Set PUBLIC_HEALTH_DEMO_SEED=true outside production.');
  process.exit(1);
}

const db = require('../server/db');
const service = require('../ng/services/public-health/publicHealthProgrammeService');

async function main() {
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const facilities = [
      ['AMAC PHC Teleconsultation Pilot', 'phc', 'public', 'AMAC', 'Wuse', 'Abuja', 'FCT'],
      ['FCTA Public Hospital Coordination Desk', 'public_hospital', 'public', 'AMAC', 'Garki', 'Abuja', 'FCT'],
      ['DoctaRx Pharmacy Coordination Node', 'pharmacy_network', 'private_partner', 'AMAC', 'Central Area', 'Abuja', 'FCT'],
    ];

    for (const facility of facilities) {
      await client.query(
        `INSERT INTO public_health_facilities (name, facility_type, ownership_type, lga, ward, city, state, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         ON CONFLICT DO NOTHING`,
        facility
      );
    }

    await client.query('COMMIT');

    const period = new Date().toISOString().slice(0, 7);
    const report = await service.generateReport({
      period,
      reportType: 'local_demo_aggregate',
      notes: 'Local-only aggregate demo seed. Not production data. Not government-submitted.',
      actorUserId: null,
    });

    const demoValues = {
      total_consultations: 42,
      teleconsultations: 26,
      completed_consultations: 31,
      cancelled_consultations: 3,
      failed_video_sessions: 2,
      audio_fallback_sessions: 5,
      active_patients: 140,
      new_patient_registrations: 18,
      patient_access_requests: 9,
      appointment_bookings: 37,
      followup_appointments: 8,
      referrals_created: 12,
      referrals_completed: 7,
      pending_referrals: 5,
      prescriptions_created: 21,
      pharmacy_referrals: 14,
      lab_referrals: 6,
      active_providers: 11,
      active_facilities: 3,
      notifications_sent: 33,
      reports_generated: 1,
      cancer_related_referrals: 2,
    };

    for (const row of report.values) {
      const value = demoValues[row.internal_key];
      if (value !== undefined) {
        await pool.query(
          `UPDATE public_health_report_values
              SET value = $1,
                  metadata_json = metadata_json || $2::jsonb
            WHERE report_id = $3 AND indicator_id = $4`,
          [
            value,
            JSON.stringify({ localDemoSeed: true, noPatientIdentifiers: true }),
            report.report.id,
            row.indicator_id,
          ]
        );
      }
    }

    await pool.query(
      `INSERT INTO public_health_insights (insight_type, severity, title, message, metric_key, period)
       VALUES
       ('local_demo', 'info', 'Local demo seeded', 'Aggregate demo values were seeded for local stakeholder walkthroughs only.', 'local_demo', $1),
       ('planning', 'info', 'Teleconsultation demand signal', 'Demo aggregate data shows teleconsultation demand as a planning signal. Replace with real operational activity before production use.', 'teleconsultations', $1)`,
      [period]
    );

    console.log(JSON.stringify({
      ok: true,
      period,
      reportId: report.report.id,
      message: 'Local-only public-health aggregate demo seed completed.',
    }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.close();
  }
}

main();
