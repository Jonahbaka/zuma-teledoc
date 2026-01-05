/**
 * Email Service
 * Handles sending emails for notifications, welcome messages, and password resets
 */

const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// Create transporter (configure based on your email provider)
const createTransporter = () => {
  // For production, use SMTP configuration from environment variables
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }
  
  // For development, use console logging (no actual email sent)
  return {
    sendMail: async (options) => {
      logger.info('Email would be sent (development mode)', {
        to: options.to,
        subject: options.subject,
        html: options.html?.substring(0, 100) + '...'
      });
      return { messageId: 'dev-' + Date.now() };
    }
  };
};

const transporter = createTransporter();

/**
 * Send welcome email to new user
 */
const sendWelcomeEmail = async (user) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const roleName = user.role === 'provider' ? 'Healthcare Provider' : 'Patient';
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Docta.</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Welcome to Docta.!</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>Welcome to Docta.! We're excited to have you as a ${roleName} on our platform.</p>
            <p>Your account has been successfully created. Please verify your email address to get started.</p>
            <p>Once verified, you can:</p>
            <ul>
              <li>Access your secure ${roleName} portal</li>
              <li>Schedule and manage appointments</li>
              <li>Communicate securely with ${user.role === 'provider' ? 'your patients' : 'your healthcare providers'}</li>
              <li>Access your health records and documentation</li>
            </ul>
            <p><strong>Important:</strong> Please check your email for a verification link to complete your registration.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}/${user.role}/dashboard" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
            </div>
            <p>If you have any questions, please don't hesitate to contact our support team.</p>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: user.email,
      subject: 'Welcome to Docta.!',
      html
    });

    logger.info('Welcome email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send welcome email', { error: error.message, userId: user.id });
    // Don't throw - email failures shouldn't break registration
  }
};

/**
 * Send appointment notification email
 */
const sendAppointmentNotification = async (appointment, recipient, type) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const scheduledDate = new Date(appointment.scheduledAt);
    const formattedDate = scheduledDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    let subject, title, message, actionText, actionUrl;

    if (type === 'created') {
      subject = recipient.role === 'provider' 
        ? `New Appointment Scheduled - ${appointment.patientFirstName} ${appointment.patientLastName}`
        : `Appointment Confirmed - Dr. ${appointment.providerFirstName} ${appointment.providerLastName}`;
      title = recipient.role === 'provider' ? 'New Appointment Scheduled' : 'Appointment Confirmed';
      message = recipient.role === 'provider'
        ? `You have a new appointment scheduled with ${appointment.patientFirstName} ${appointment.patientLastName}.`
        : `Your appointment with Dr. ${appointment.providerFirstName} ${appointment.providerLastName} has been confirmed.`;
      actionText = 'View Appointment';
      actionUrl = `${appUrl}/${recipient.role}/appointments/${appointment.id}`;
    } else if (type === 'reminder') {
      subject = `Appointment Reminder - ${formattedDate}`;
      title = 'Appointment Reminder';
      message = recipient.role === 'provider'
        ? `Reminder: You have an appointment with ${appointment.patientFirstName} ${appointment.patientLastName} coming up.`
        : `Reminder: You have an appointment with Dr. ${appointment.providerFirstName} ${appointment.providerLastName} coming up.`;
      actionText = 'View Appointment';
      actionUrl = `${appUrl}/${recipient.role}/appointments/${appointment.id}`;
    } else if (type === 'cancelled') {
      subject = 'Appointment Cancelled';
      title = 'Appointment Cancelled';
      message = recipient.role === 'provider'
        ? `The appointment with ${appointment.patientFirstName} ${appointment.patientLastName} has been cancelled.`
        : `Your appointment with Dr. ${appointment.providerFirstName} ${appointment.providerLastName} has been cancelled.`;
      actionText = 'View Appointments';
      actionUrl = `${appUrl}/${recipient.role}/appointments`;
    } else {
      subject = 'Appointment Updated';
      title = 'Appointment Updated';
      message = 'Your appointment details have been updated.';
      actionText = 'View Appointment';
      actionUrl = `${appUrl}/${recipient.role}/appointments/${appointment.id}`;
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">${title}</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${recipient.firstName} ${recipient.lastName},</p>
            <p>${message}</p>
            <div style="background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #10b981;">
              <p style="margin: 0;"><strong>Date & Time:</strong> ${formattedDate}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${appointment.durationMinutes || 30} minutes</p>
              <p style="margin: 5px 0;"><strong>Type:</strong> ${appointment.type === 'video' ? 'Video Consultation' : appointment.type}</p>
              ${appointment.reasonForVisit ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${appointment.reasonForVisit}</p>` : ''}
            </div>
            ${actionUrl ? `
              <div style="text-align: center; margin: 30px 0;">
                <a href="${actionUrl}" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">${actionText}</a>
              </div>
            ` : ''}
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: recipient.email,
      subject,
      html
    });

    logger.info('Appointment notification email sent', { 
      appointmentId: appointment.id, 
      recipientId: recipient.id,
      type 
    });
  } catch (error) {
    logger.error('Failed to send appointment notification email', { 
      error: error.message, 
      appointmentId: appointment.id 
    });
    // Don't throw - email failures shouldn't break appointment creation
  }
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (user, resetToken) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Password Reset Request</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>We received a request to reset your password for your Docta. account.</p>
            <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
            </div>
            <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
            <p style="font-size: 12px; color: #666; margin-top: 30px;">For security reasons, this link will expire in 1 hour.</p>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: user.email,
      subject: 'Reset Your Password - Docta.',
      html
    });

    logger.info('Password reset email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send password reset email', { error: error.message, userId: user.id });
    throw error; // Password reset emails are critical
  }
};

/**
 * Send email verification email
 */
const sendVerificationEmail = async (user, verificationToken) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Verify Your Email Address</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>Thank you for signing up for Docta.! Please verify your email address to complete your registration.</p>
            <p>Click the button below to verify your email address. This link will expire in 24 hours.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" style="background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email Address</a>
            </div>
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #059669; font-size: 12px;">${verificationUrl}</p>
            <p>If you didn't create an account with Docta., please ignore this email.</p>
            <p style="font-size: 12px; color: #666; margin-top: 30px;">For security reasons, this link will expire in 24 hours.</p>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: user.email,
      subject: 'Verify Your Email - Docta.',
      html
    });

    logger.info('Verification email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send verification email', { error: error.message, userId: user.id });
    throw error; // Verification emails are critical
  }
};

/**
 * Send admin message email to user
 */
const sendAdminMessage = async (recipient, subject, content, adminName) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const dashboardPath = recipient.role === 'provider' ? 'provider' : recipient.role === 'admin' ? 'admin' : 'patient';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Message from Docta. Admin</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${recipient.first_name || recipient.firstName} ${recipient.last_name || recipient.lastName},</p>
            <div style="background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #7c3aed;">
              <h3 style="margin-top: 0; color: #7c3aed;">${subject}</h3>
              <p style="white-space: pre-wrap;">${content}</p>
            </div>
            <p style="color: #666; font-size: 14px;">This message was sent by ${adminName} from the Docta. Admin team.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}/${dashboardPath}/notifications" style="background: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">View in Dashboard</a>
            </div>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: recipient.email,
      subject: `[Docta.] ${subject}`,
      html
    });

    logger.info('Admin message email sent', { recipientId: recipient.id, email: recipient.email, subject });
  } catch (error) {
    logger.error('Failed to send admin message email', { error: error.message, recipientId: recipient.id });
    // Don't throw - admin message email failures shouldn't break the flow
  }
};

/**
 * Send new message notification email
 */
const sendNewMessageEmail = async (recipient, senderName, isUrgent = false) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const dashboardPath = recipient.role === 'provider' ? 'provider' : 'patient';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Message on Docta.</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, ${isUrgent ? '#dc2626' : '#7c3aed'} 0%, ${isUrgent ? '#b91c1c' : '#6d28d9'} 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">${isUrgent ? '🔴 Urgent Message' : 'New Message'}</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hello ${recipient.first_name || recipient.firstName},</p>
            <p>You have a new ${isUrgent ? '<strong style="color: #dc2626;">urgent</strong> ' : ''}message from <strong>${senderName}</strong> on Docta.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}/${dashboardPath}/messages" style="background: ${isUrgent ? '#dc2626' : '#7c3aed'}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">View Message</a>
            </div>
            <p style="font-size: 12px; color: #666;">For your privacy, message content is not included in this email. Please log in to view your messages.</p>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: recipient.email,
      subject: isUrgent ? '🔴 [Urgent] New message on Docta.' : 'New message on Docta.',
      html
    });

    logger.info('New message notification email sent', { recipientId: recipient.id, senderName, isUrgent });
  } catch (error) {
    logger.error('Failed to send new message email', { error: error.message, recipientId: recipient.id });
    // Don't throw - email failures shouldn't break messaging
  }
};

/**
 * Send ops/alert email (webhooks, readiness, critical failures)
 */
const sendOpsAlertEmail = async ({ subject, html, text, metadata }) => {
  try {
    const to = process.env.ALERT_ADMIN_EMAIL || 'evolvedu@outlook.com';
    const safeSubject = subject?.slice(0, 200) || 'Docta. Ops Alert';

    const bodyHtml = html || `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <h2 style="margin:0 0 12px 0;">${safeSubject}</h2>
        <pre style="background:#0b1220;color:#e5e7eb;padding:16px;border-radius:10px;overflow:auto;">${(text || '').replace(/</g, '&lt;')}</pre>
        ${metadata ? `<pre style="background:#f3f4f6;padding:12px;border-radius:10px;overflow:auto;">${JSON.stringify(metadata, null, 2)}</pre>` : ''}
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to,
      subject: `[Docta. ALERT] ${safeSubject}`,
      html: bodyHtml,
      text: text || undefined
    });

    logger.info('Ops alert email sent', { to, subject: safeSubject });
  } catch (error) {
    logger.error('Failed to send ops alert email', { error: error.message, subject });
    // Don't throw – alerting must not crash production flows
  }
};

module.exports = {
  sendWelcomeEmail,
  sendAppointmentNotification,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendAdminMessage,
  sendNewMessageEmail,
  sendOpsAlertEmail
};

