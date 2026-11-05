/** Public, nonclinical business enquiries. Never log submitted content. */
const express = require('express');
const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');
const { z } = require('zod');
const router = express.Router();
const ADMIN_EMAIL = 'evolvedu@outlook.com';
const PUBLIC_EMAIL = 'info@doctarx.com';
const contactSchema = z.object({
  name: z.string().trim().min(2).max(100).regex(/^[^\r\n]+$/),
  email: z.string().trim().max(254).email().regex(/^[^\r\n]+$/),
  subject: z.string().trim().min(5).max(200).regex(/^[^\r\n]+$/),
  message: z.string().trim().min(10).max(5000),
  type: z.enum(['general', 'support', 'enterprise', 'partnership', 'billing']).default('general'),
});
const typeLabels = { general: 'General Inquiry', support: 'Technical Support', enterprise: 'Enterprise Solutions', partnership: 'Partnership Opportunity', billing: 'Billing Question' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function createTransporter() {
  const port = Number(process.env.SMTP_PORT);
  if (!process.env.SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
}

// A resolved SMTP call or message ID alone is not proof of recipient acceptance.
function acceptedRecipient(result, recipient) {
  const addresses = list => Array.isArray(list) ? list.map(item => typeof item === 'string' ? item.toLowerCase() : typeof item?.address === 'string' ? item.address.toLowerCase() : '') : [];
  const expected = recipient.toLowerCase();
  return addresses(result?.accepted).includes(expected) && !addresses(result?.rejected).includes(expected) && !addresses(result?.pending).includes(expected);
}

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, code: 'CONTACT_INVALID', error: 'Check your name, email, subject and message, then submit again.' });
  const data = parsed.data;
  let transporter;
  try { transporter = createTransporter(); } catch { /* Configuration errors must not expose SMTP settings. */ }
  if (!transporter) {
    logger.warn('Contact form delivery unavailable', { stage: 'configuration' });
    return res.status(503).json({ success: false, code: 'CONTACT_UNAVAILABLE', error: 'The contact form is unavailable. Your message was not sent. You can email info@doctarx.com for nonclinical enquiries.', contactEmail: PUBLIC_EMAIL });
  }

  const label = typeLabels[data.type];
  let result;
  try {
    result = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com', to: ADMIN_EMAIL, replyTo: data.email,
      subject: `[DoctaRx ${label}] ${data.subject}`,
      text: `Nonclinical contact enquiry\nType: ${label}\nName: ${data.name}\nEmail: ${data.email}\nSubject: ${data.subject}\n\n${data.message}`,
      html: `<!doctype html><html><body><h1>Nonclinical contact enquiry</h1><p><strong>Type:</strong> ${escapeHtml(label)}</p><p><strong>Name:</strong> ${escapeHtml(data.name)}</p><p><strong>Email:</strong> ${escapeHtml(data.email)}</p><p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p><div style="white-space:pre-wrap">${escapeHtml(data.message)}</div></body></html>`,
    });
  } catch {
    logger.warn('Contact form delivery unconfirmed', { stage: 'primary' });
    return res.status(503).json({ success: false, code: 'CONTACT_UNCONFIRMED', error: 'We could not confirm delivery. Keep a copy of your message. You can contact info@doctarx.com and mention this attempt to avoid duplicates.', contactEmail: PUBLIC_EMAIL });
  }
  if (!acceptedRecipient(result, ADMIN_EMAIL)) {
    logger.warn('Contact form recipient acceptance unconfirmed', { stage: 'primary' });
    return res.status(503).json({ success: false, code: 'CONTACT_UNCONFIRMED', error: 'We could not confirm delivery. Keep a copy of your message. You can contact info@doctarx.com and mention this attempt to avoid duplicates.', contactEmail: PUBLIC_EMAIL });
  }

  // Primary acceptance is the submission boundary. A failed acknowledgement
  // must not turn a received enquiry into an error that encourages duplicate sends.
  let acknowledgementSent = false;
  try {
    const acknowledgement = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com', to: data.email,
      subject: 'Thank you for contacting DoctaRx',
      text: 'Your nonclinical enquiry has been accepted by our mail service for the DoctaRx team. No need to submit it again. This inbox is not for medical advice or emergencies. Please do not send health records or credential documents.',
      html: `<!doctype html><html><body><p>Dear ${escapeHtml(data.name)},</p><p>Your nonclinical enquiry has been accepted by our mail service for the DoctaRx team. No need to submit it again.</p><p>This inbox is not for medical advice or emergencies. Please do not send health records or credential documents.</p><p>The DoctaRx team</p></body></html>`,
    });
    acknowledgementSent = acceptedRecipient(acknowledgement, data.email);
  } catch { /* Primary email is already accepted; do not leak transport errors. */ }
  if (!acknowledgementSent) logger.warn('Contact acknowledgement unavailable after primary acceptance', { stage: 'acknowledgement' });
  logger.info('Contact enquiry accepted by mail service', { acknowledgementSent });
  return res.status(200).json({ success: true, message: 'Message accepted by our mail service for the DoctaRx team.', acknowledgementSent });
});

module.exports = router;
