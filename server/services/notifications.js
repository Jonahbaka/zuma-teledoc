/**
 * Notification Service
 * Centralized notification creation and management
 */

const db = require('../db');
const logger = require('../middleware/logger');

/**
 * Notification types from the database enum
 */
const NotificationType = {
  APPOINTMENT: 'appointment',
  MESSAGE: 'message',
  SYSTEM: 'system',
  BILLING: 'billing',
  REMINDER: 'reminder',
  ALERT: 'alert'
};

/**
 * Create a notification for a user
 * @param {Object} params - Notification parameters
 * @param {string} params.userId - User ID to notify
 * @param {string} params.type - Notification type
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message
 * @param {string} [params.referenceType] - Type of referenced entity
 * @param {string} [params.referenceId] - ID of referenced entity
 * @param {string} [params.actionUrl] - URL for action button
 * @param {string} [params.actionText] - Text for action button
 * @param {Date} [params.expiresAt] - Expiration date
 * @returns {Promise<Object>} Created notification
 */
const createNotification = async ({
  userId,
  type,
  title,
  message,
  referenceType = null,
  referenceId = null,
  actionUrl = null,
  actionText = null,
  expiresAt = null
}) => {
  try {
    const { rows } = await db.query(
      `INSERT INTO notifications (
        user_id, type, title, message, reference_type, 
        reference_id, action_url, action_text, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [userId, type, title, message, referenceType, referenceId, actionUrl, actionText, expiresAt]
    );
    
    logger.info('Notification created', { 
      notificationId: rows[0].id, 
      userId, 
      type, 
      title 
    });
    
    return rows[0];
  } catch (error) {
    logger.error('Failed to create notification', { error: error.message, userId, type });
    // Don't throw - notification failures shouldn't break main flows
    return null;
  }
};

/**
 * Create multiple notifications in batch
 * @param {Array<Object>} notifications - Array of notification params
 * @returns {Promise<number>} Number of notifications created
 */
const createBatchNotifications = async (notifications) => {
  let created = 0;
  for (const notification of notifications) {
    const result = await createNotification(notification);
    if (result) created++;
  }
  return created;
};

/**
 * Send welcome notification to new user
 */
const sendWelcomeNotification = async (user) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  const roleMessages = {
    patient: {
      title: 'Welcome to DoctaRx! 🎉',
      message: `Hi ${user.firstName}! Your account has been created. Start by booking your first appointment with one of our healthcare providers.`,
      actionUrl: `${appUrl}/patient/appointments/book`,
      actionText: 'Book Appointment'
    },
    provider: {
      title: 'Welcome to DoctaRx! 🎉',
      message: `Hi Dr. ${user.lastName}! Your provider account has been created. Your profile is pending verification. You'll be notified once approved.`,
      actionUrl: `${appUrl}/provider/profile`,
      actionText: 'Complete Profile'
    },
    admin: {
      title: 'Admin Account Created',
      message: `Welcome ${user.firstName}! Your admin account is now active. Access the admin dashboard to manage the platform.`,
      actionUrl: `${appUrl}/admin/dashboard`,
      actionText: 'Go to Dashboard'
    }
  };
  
  const roleConfig = roleMessages[user.role] || roleMessages.patient;
  
  return createNotification({
    userId: user.id,
    type: NotificationType.SYSTEM,
    title: roleConfig.title,
    message: roleConfig.message,
    actionUrl: roleConfig.actionUrl,
    actionText: roleConfig.actionText
  });
};

/**
 * Send notification when provider is approved/rejected
 */
const sendProviderStatusNotification = async (provider, status, reason = null) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  const statusMessages = {
    approved: {
      title: 'Account Approved! ✅',
      message: `Congratulations Dr. ${provider.lastName}! Your provider account has been verified. You can now start accepting appointments.`,
      actionUrl: `${appUrl}/provider/schedule`,
      actionText: 'Set Up Schedule'
    },
    rejected: {
      title: 'Verification Issue',
      message: `Hi Dr. ${provider.lastName}, there was an issue with your verification. ${reason || 'Please contact support for more information.'}`,
      actionUrl: `${appUrl}/provider/profile`,
      actionText: 'View Profile'
    },
    suspended: {
      title: 'Account Suspended',
      message: `Your account has been temporarily suspended. ${reason || 'Please contact support for assistance.'}`,
      actionUrl: null,
      actionText: null
    }
  };
  
  const config = statusMessages[status];
  if (!config) return null;
  
  return createNotification({
    userId: provider.id,
    type: NotificationType.ALERT,
    title: config.title,
    message: config.message,
    actionUrl: config.actionUrl,
    actionText: config.actionText
  });
};

/**
 * Send notification for new appointment
 */
const sendAppointmentNotification = async (appointment, recipientId, recipientRole, eventType) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  const scheduledDate = new Date(appointment.scheduledAt);
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
  
  const eventMessages = {
    created: {
      patient: {
        title: 'Appointment Confirmed',
        message: `Your appointment with Dr. ${appointment.providerLastName || 'Provider'} is scheduled for ${formattedDate}.`,
        actionText: 'View Appointment'
      },
      provider: {
        title: 'New Appointment',
        message: `New appointment with ${appointment.patientFirstName || 'Patient'} ${appointment.patientLastName || ''} scheduled for ${formattedDate}.`,
        actionText: 'View Details'
      }
    },
    cancelled: {
      patient: {
        title: 'Appointment Cancelled',
        message: `Your appointment scheduled for ${formattedDate} has been cancelled.`,
        actionText: 'Book New'
      },
      provider: {
        title: 'Appointment Cancelled',
        message: `Appointment with ${appointment.patientFirstName || 'Patient'} for ${formattedDate} was cancelled.`,
        actionText: 'View Schedule'
      }
    },
    reminder: {
      patient: {
        title: 'Appointment Reminder',
        message: `Reminder: Your appointment with Dr. ${appointment.providerLastName || 'Provider'} is coming up on ${formattedDate}.`,
        actionText: 'Join Now'
      },
      provider: {
        title: 'Upcoming Appointment',
        message: `Reminder: Appointment with ${appointment.patientFirstName || 'Patient'} at ${formattedDate}.`,
        actionText: 'Start Session'
      }
    },
    updated: {
      patient: {
        title: 'Appointment Updated',
        message: `Your appointment has been rescheduled to ${formattedDate}.`,
        actionText: 'View Details'
      },
      provider: {
        title: 'Appointment Updated',
        message: `Appointment with ${appointment.patientFirstName || 'Patient'} has been updated.`,
        actionText: 'View Details'
      }
    }
  };
  
  const config = eventMessages[eventType]?.[recipientRole];
  if (!config) return null;
  
  const dashboardPath = recipientRole === 'provider' ? 'provider' : 'patient';
  
  return createNotification({
    userId: recipientId,
    type: NotificationType.APPOINTMENT,
    title: config.title,
    message: config.message,
    referenceType: 'appointment',
    referenceId: appointment.id,
    actionUrl: `${appUrl}/${dashboardPath}/appointments/${appointment.id}`,
    actionText: config.actionText
  });
};

/**
 * Send notification for new message
 */
const sendMessageNotification = async (senderId, senderName, recipientId, messageId, isUrgent = false) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  // Get recipient role
  const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [recipientId]);
  const recipientRole = rows[0]?.role || 'patient';
  const dashboardPath = recipientRole === 'provider' ? 'provider' : recipientRole === 'admin' ? 'admin' : 'patient';
  
  return createNotification({
    userId: recipientId,
    type: NotificationType.MESSAGE,
    title: isUrgent ? '🔴 Urgent Message' : 'New Message',
    message: `You have a new ${isUrgent ? 'urgent ' : ''}message from ${senderName}.`,
    referenceType: 'message',
    referenceId: messageId,
    actionUrl: `${appUrl}/${dashboardPath}/messages`,
    actionText: 'View Message'
  });
};

/**
 * Send admin message notification to a user
 */
const sendAdminMessageNotification = async (recipientId, adminName, subject, content) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  // Get recipient role
  const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [recipientId]);
  const recipientRole = rows[0]?.role || 'patient';
  const dashboardPath = recipientRole === 'provider' ? 'provider' : recipientRole === 'admin' ? 'admin' : 'patient';
  
  return createNotification({
    userId: recipientId,
    type: NotificationType.SYSTEM,
    title: subject || 'Message from Admin',
    message: content.length > 200 ? content.substring(0, 200) + '...' : content,
    actionUrl: `${appUrl}/${dashboardPath}/notifications`,
    actionText: 'View Details'
  });
};

/**
 * Send billing notification
 */
const sendBillingNotification = async (userId, title, message, invoiceId = null) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  return createNotification({
    userId,
    type: NotificationType.BILLING,
    title,
    message,
    referenceType: invoiceId ? 'invoice' : null,
    referenceId: invoiceId,
    actionUrl: `${appUrl}/patient/billing`,
    actionText: 'View Billing'
  });
};

/**
 * Send triage alert notification to provider
 */
const sendTriageAlertNotification = async (providerId, patientName, severity, appointmentId) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  const severityLabels = {
    5: '🔴 CRITICAL',
    4: '🟠 URGENT',
    3: '🟡 MODERATE',
    2: '🟢 ROUTINE',
    1: '⚪ LOW'
  };
  
  return createNotification({
    userId: providerId,
    type: NotificationType.ALERT,
    title: `${severityLabels[severity] || 'NEW'} Triage Alert`,
    message: `${patientName} has submitted triage information for their upcoming appointment.`,
    referenceType: 'appointment',
    referenceId: appointmentId,
    actionUrl: `${appUrl}/provider/triage`,
    actionText: 'Review Triage'
  });
};

/**
 * Broadcast notification to all users or specific role
 */
const broadcastNotification = async (title, message, targetRole = null, adminId = null) => {
  try {
    let query = 'SELECT id FROM users WHERE is_active = true';
    const values = [];
    
    if (targetRole) {
      query += ' AND role = $1';
      values.push(targetRole);
    }
    
    const { rows: users } = await db.query(query, values);
    
    const notifications = users.map(user => ({
      userId: user.id,
      type: NotificationType.SYSTEM,
      title,
      message
    }));
    
    const created = await createBatchNotifications(notifications);
    
    logger.info('Broadcast notification sent', { 
      adminId,
      recipientCount: created,
      targetRole: targetRole || 'all'
    });
    
    return created;
  } catch (error) {
    logger.error('Broadcast notification failed', { error: error.message });
    throw error;
  }
};

module.exports = {
  NotificationType,
  createNotification,
  createBatchNotifications,
  sendWelcomeNotification,
  sendProviderStatusNotification,
  sendAppointmentNotification,
  sendMessageNotification,
  sendAdminMessageNotification,
  sendBillingNotification,
  sendTriageAlertNotification,
  broadcastNotification
};

