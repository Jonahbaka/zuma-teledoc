/**
 * ═══════════════════════════════════════════════════════════════
 *  APP NERVE BRIDGE — Connects the Application to the Agent Nervous System
 * ═══════════════════════════════════════════════════════════════
 * 
 *  This is the "spinal cord" that connects the real DoctaRx application
 *  (appointments, payments, messages, prescriptions, auth) to the
 *  agent Event Bus so agents react to real activity.
 *  
 *  Every real business action emits a signal. Agents hear it.
 *  The patient gets a reminder. The provider gets notified.
 *  Revenue agent sees a payment. Compliance sees a PHI access.
 *  
 *  Usage: require this module in server/index.js after routes are loaded.
 *         Call bridge.attach(app) to hook into Express middleware.
 * ═══════════════════════════════════════════════════════════════
 */

let eventBus = null;

/**
 * Safely emit an event — never crashes the app if bus is down
 */
async function emit(type, payload = {}) {
  if (!eventBus) {
    try {
      const orchestrator = require('./index');
      eventBus = orchestrator.eventBus;
    } catch (e) { return; }
  }
  if (!eventBus) return;

  try {
    await eventBus.emit(type, payload, 'app');
  } catch (e) {
    // Never crash the app for an event failure
  }
}

/**
 * Express middleware that listens to responses and emits events.
 * Attach AFTER routes: app.use(bridge.middleware())
 */
function middleware() {
  return (req, res, next) => {
    // Capture the original json method
    const originalJson = res.json.bind(res);

    res.json = function(body) {
      // Only emit on successful responses
      if (body && body.success !== false && res.statusCode < 400) {
        detectAndEmit(req, res, body);
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Detect what just happened and emit the right event
 */
function detectAndEmit(req, res, body) {
  const method = req.method;
  const path = req.originalUrl || req.url;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  // ─── APPOINTMENTS ─────────────────────────────────────────────
  if (path.includes('/api/appointments')) {
    if (method === 'POST' && res.statusCode < 300) {
      emit('patient.appointment.booked', {
        appointmentId: body.appointment?.id || body.data?.id,
        patientId: body.appointment?.patientId || userId,
        providerId: body.appointment?.providerId,
        scheduledAt: body.appointment?.scheduledAt,
        type: body.appointment?.type
      });
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (body.appointment?.status === 'cancelled' || path.includes('/cancel')) {
        emit('patient.appointment.cancelled', {
          appointmentId: body.appointment?.id,
          patientId: body.appointment?.patientId,
          reason: body.appointment?.cancellationReason
        });
      }
      if (body.appointment?.status === 'completed') {
        emit('patient.appointment.completed', {
          appointmentId: body.appointment?.id,
          patientId: body.appointment?.patientId,
          providerId: body.appointment?.providerId
        });
      }
    }
  }

  // ─── PAYMENTS ─────────────────────────────────────────────────
  if (path.includes('/api/payments')) {
    if (method === 'POST' && res.statusCode < 300) {
      emit('payment.received', {
        paymentId: body.payment?.id || body.data?.id,
        amount: body.payment?.amount || body.data?.amount,
        patientId: userId,
        type: body.payment?.type || 'payment'
      });
    }
  }

  // ─── MESSAGES ─────────────────────────────────────────────────
  if (path.includes('/api/messages') && method === 'POST') {
    emit('patient.message.received', {
      fromUserId: userId,
      fromRole: userRole,
      toUserId: body.message?.recipientId || body.data?.recipientId,
      conversationId: body.message?.conversationId
    });
  }

  // ─── PRESCRIPTIONS ───────────────────────────────────────────
  if (path.includes('/api/prescriptions') && method === 'POST') {
    emit('provider.prescription.written', {
      prescriptionId: body.prescription?.id || body.data?.id,
      providerId: userId,
      patientId: body.prescription?.patientId || body.data?.patientId,
      medication: body.prescription?.medicationName || body.data?.medicationName
    });
  }

  // ─── AUTH (Registration) ──────────────────────────────────────
  if (path.includes('/api/auth/register') && method === 'POST' && res.statusCode < 300) {
    const role = body.user?.role || body.data?.role;
    if (role === 'patient') {
      emit('patient.registered', { userId: body.user?.id || body.data?.id });
    } else if (role === 'provider') {
      emit('provider.registered', { userId: body.user?.id || body.data?.id });
    }
  }

  // ─── VISITS (Clinical encounters) ────────────────────────────
  if (path.includes('/api/visits') && method === 'POST') {
    emit('compliance.phi.accessed', {
      accessedBy: userId,
      accessType: 'clinical_encounter_created',
      patientId: body.visit?.patientId || body.data?.patientId
    });
  }

  // ─── INSURANCE CLAIMS ─────────────────────────────────────────
  if (path.includes('/api/claims')) {
    if (method === 'POST') {
      emit('claim.submitted', {
        claimId: body.claim?.id || body.data?.id,
        patientId: body.claim?.patientId,
        amount: body.claim?.amount
      });
    }
  }

  // ─── SUBSCRIPTIONS ────────────────────────────────────────────
  if (path.includes('/api/subscriptions')) {
    if (method === 'POST') {
      emit('subscription.created', {
        subscriptionId: body.subscription?.id || body.data?.id,
        userId: userId,
        plan: body.subscription?.plan || body.data?.plan
      });
    }
    if (method === 'DELETE' || (method === 'PUT' && path.includes('/cancel'))) {
      emit('subscription.cancelled', {
        subscriptionId: body.subscription?.id || body.data?.id,
        userId: userId
      });
    }
  }
}

module.exports = {
  middleware,
  emit
};
