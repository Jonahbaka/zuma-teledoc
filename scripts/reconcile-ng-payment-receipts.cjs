'use strict';
require('dotenv').config();
const { getPool, close } = require('../server/db');
const { processReceipt } = require('../ng/services/payments/paymentWebhookService');

async function main() {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM ng_integration_webhook_receipts WHERE provider = 'paystack' AND status IN ('received','failed') ORDER BY received_at LIMIT 100");
  let processed = 0;
  let failed = 0;
  for (const receipt of rows) {
    try { await processReceipt(pool, receipt); processed++; }
    catch { failed++; }
  }
  console.log(JSON.stringify({ examined: rows.length, processed, failed }));
  await close();
  if (failed) process.exitCode = 1;
}
main().catch(async () => { console.error('Receipt reconciliation failed. Verify migrations and provider configuration.'); await close(); process.exitCode = 1; });
