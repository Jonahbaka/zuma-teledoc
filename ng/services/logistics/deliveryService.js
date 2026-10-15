'use strict';

// Every dispatch passes through consent, readiness, fresh-quote, payment and
// durable booking checks. Distance fares and simulated riders are not supported.
const workflow = require('./medicationDeliveryWorkflowService');
module.exports = {
  requestDelivery: (orderId, actor, input) => workflow.dispatch(orderId, actor, input),
  getTracking: (trackingId, actor) => workflow.getTracking(trackingId, actor),
  acceptWebhook: (raw, headers) => workflow.acceptCourierWebhook(raw, headers),
};
