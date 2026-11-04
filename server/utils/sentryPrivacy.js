'use strict';

const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);
const EVENT_ID = /^[a-f0-9]{32}$/i;

function arrayLength(value) {
  if (!Array.isArray(value)) return 0;
  const length = value.length;
  return Number.isSafeInteger(length) && length >= 0 ? length : 0;
}

function scrubFrame(frame) {
  const rawFilename = frame?.filename;
  if (typeof rawFilename !== 'string') return null;
  // Only retain locations of JavaScript modules actually loaded by this app.
  // Do not transmit absolute paths, supplied error.stack text, function names,
  // source snippets, locals, or filenames assembled from request/upload data.
  const filename = path.isAbsolute(rawFilename) ? rawFilename : path.resolve(ROOT, rawFilename);
  if (!require.cache[filename]) return null;
  const relative = path.relative(ROOT, filename).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative) || !/^(server|lib|ng|node_modules)\/[A-Za-z0-9_@./-]+\.(?:[cm]?js|ts)$/.test(relative)) return null;
  const clean = { filename: relative };
  for (const key of ['lineno', 'colno']) {
    const coordinate = frame[key];
    if (Number.isSafeInteger(coordinate) && coordinate > 0) clean[key] = coordinate;
  }
  const inApp = frame.in_app;
  if (typeof inApp === 'boolean') clean.in_app = inApp;
  return clean;
}

function scrubSentryEvent(event, hint) {
  try {
    // Attachments bypass the event body. Remove them even when dropping an event.
    if (hint) hint.attachments = [];
    if (!event) return null;
    // Accessors may change on later reads. Validate and copy the SAME snapshot,
    // including nested containers; never call methods supplied by input arrays.
    const eventType = event.type;
    if (eventType) return null;
    const rawException = event.exception;
    const rawValues = rawException?.values;
    const valueCount = Math.min(arrayLength(rawValues), 10);
    const values = [];
    for (let index = 0; index < valueCount; index++) {
      const exception = rawValues[index];
      if (!exception) continue;
      const errorType = exception.type;
      const clean = {
        type: ERROR_TYPES.has(errorType) ? errorType : 'Error',
        value: '[Redacted error message]'
      };
      const mechanism = exception.mechanism;
      const handled = mechanism?.handled;
      if (typeof handled === 'boolean') clean.mechanism = { type: 'generic', handled };
      const stacktrace = exception.stacktrace;
      const rawFrames = stacktrace?.frames;
      const frameCount = arrayLength(rawFrames);
      const frames = [];
      for (let frameIndex = Math.max(0, frameCount - 100); frameIndex < frameCount; frameIndex++) {
        const frame = scrubFrame(rawFrames[frameIndex]);
        if (frame) frames.push(frame);
      }
      if (frames.length) clean.stacktrace = { frames };
      values.push(clean);
    }
    if (!values.length) return null;
    const level = event.level;
    const eventId = event.event_id;
    const timestamp = event.timestamp;
    const clean = {
      platform: 'node',
      level: level === 'fatal' ? 'fatal' : 'error',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      tags: { component: 'express-api' },
      exception: { values }
    };
    if (typeof eventId === 'string' && EVENT_ID.test(eventId)) clean.event_id = eventId;
    if (Number.isFinite(timestamp)) clean.timestamp = timestamp;
    return clean;
  } catch {
    // Fail closed, without logging the original event or the scrubber failure.
    return null;
  }
}

function createSentryPrivacyTransport(makeTransport) {
  return (options) => {
    const transport = makeTransport(options);
    return {
      flush: (timeout) => transport.flush(timeout),
      send(envelope) {
        try {
          // Last-mile enforcement also covers SDK internal errors, which can
          // bypass beforeSend, and direct client.sendEvent/sendEnvelope calls.
          // Deny all non-error items (attachments, logs, spans, sessions, etc.).
          const items = envelope?.[1];
          const itemCount = Math.min(arrayLength(items), 100);
          const cleanItems = [];
          for (let index = 0; index < itemCount; index++) {
            const item = items[index];
            if (!Array.isArray(item)) continue;
            const itemHeader = item[0];
            const itemType = itemHeader?.type;
            if (itemType !== 'event') continue;
            const payload = item[1];
            const clean = scrubSentryEvent(payload);
            if (clean) cleanItems.push([{ type: 'event' }, clean]);
          }
          if (!cleanItems.length) return Promise.resolve({});
          const header = { sent_at: new Date().toISOString() };
          const eventId = cleanItems[0][1].event_id;
          if (eventId) header.event_id = eventId;
          // Never forward incoming dynamic sampling context/envelope headers.
          return transport.send([header, cleanItems]);
        } catch {
          return Promise.resolve({});
        }
      }
    };
  };
}

module.exports = { scrubSentryEvent, createSentryPrivacyTransport };
