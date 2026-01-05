/**
 * Ops Alerts Service
 * Sends critical operational alerts via email and (optionally) in-app notifications.
 *
 * Configure:
 * - ALERT_ADMIN_EMAIL (default: evolvedu@outlook.com)
 * - ALERT_ADMIN_USER_ID (optional UUID; if set, will create in-app notifications)
 */

const logger = require('../middleware/logger');
const emailService = require('./email');
const notificationService = require('./notifications');

async function notifyOpsAlert({ title, message, metadata = {}, actionUrl = null }) {
  const adminUserId = process.env.ALERT_ADMIN_USER_ID;

  // Email is always sent
  await emailService.sendOpsAlertEmail({
    subject: title,
    text: message,
    metadata
  });

  // In-app is optional (requires a known admin userId)
  if (adminUserId) {
    await notificationService.createNotification({
      userId: adminUserId,
      type: 'alert',
      title,
      message,
      referenceType: metadata?.referenceType || 'ops',
      referenceId: metadata?.referenceId || null,
      actionUrl,
      actionText: actionUrl ? 'View' : null
    });
  } else {
    logger.warn('Ops in-app alert skipped (ALERT_ADMIN_USER_ID not set)', { title });
  }
}

async function notifyStripeWebhookFailure({ requestId, eventId, eventType, errorMessage }) {
  const title = 'Stripe webhook failure';
  const message = `Stripe webhook processing failed.\n\nEvent: ${eventType || 'unknown'} (${eventId || 'unknown'})\nRequestId: ${requestId || 'n/a'}\nError: ${errorMessage || 'unknown'}`;

  return notifyOpsAlert({
    title,
    message,
    metadata: {
      referenceType: 'stripe_webhook',
      referenceId: eventId || null,
      eventType,
      requestId
    }
  });
}

async function notifyReadinessFailure({ details }) {
  const title = 'Readiness check failing';
  const message = `The /api/ready endpoint is reporting NOT READY.\n\nDetails:\n${JSON.stringify(details, null, 2)}`;

  return notifyOpsAlert({
    title,
    message,
    metadata: { referenceType: 'readiness' }
  });
}

module.exports = {
  notifyOpsAlert,
  notifyStripeWebhookFailure,
  notifyReadinessFailure
};


