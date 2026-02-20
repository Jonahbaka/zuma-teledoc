/**
 * Email Service
 * Handles sending emails for notifications, welcome messages, and password resets
 * Features: Elegant templates, spam prevention, HIPAA compliance
 */

const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// Brand colors
const BRAND = {
  primary: '#7c3aed',      // Purple
  primaryDark: '#6d28d9',
  secondary: '#10b981',    // Emerald/Teal
  secondaryDark: '#059669',
  accent: '#f59e0b',       // Amber
  dark: '#1e1b4b',         // Dark indigo
  light: '#f8fafc',
  white: '#ffffff',
  gray: '#64748b',
  lightGray: '#e2e8f0'
};

// Company info for CAN-SPAM compliance
const COMPANY = {
  name: 'DoctaRx',
  fullName: 'DoctaRx Telehealth Services',
  phone: '408-585-9255',
  website: 'https://doctarx.com',
  supportEmail: 'support@doctarx.com'
};

// Create transporter with enhanced configuration
const createTransporter = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      },
      // Enhanced settings for better deliverability
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5
    });
  }
  
  // Development mode - log only
  return {
    sendMail: async (options) => {
      logger.info('Email would be sent (development mode)', {
        to: options.to,
        subject: options.subject,
        preview: options.text?.substring(0, 100) + '...'
      });
      return { messageId: 'dev-' + Date.now() };
    }
  };
};

const transporter = createTransporter();

/**
 * Generate base email template with elegant styling
 */
const generateEmailTemplate = ({
  preheader = '',
  headerIcon = '🏥',
  headerTitle,
  headerSubtitle = '',
  headerColor = BRAND.primary,
  headerColorEnd = BRAND.primaryDark,
  bodyContent,
  ctaButton = null, // { text, url, color }
  footerNote = '',
  recipientEmail = ''
}) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${headerTitle}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style>
    table {border-collapse: collapse;}
    .spacer, .divider {mso-line-height-rule: exactly;}
  </style>
  <![endif]-->
  <style>
    /* Reset */
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f1f5f9; }
    
    /* Responsive */
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
      .header-padding { padding: 32px 20px !important; }
      .mobile-center { text-align: center !important; }
      .mobile-full-width { width: 100% !important; display: block !important; }
      .cta-button { width: 100% !important; }
    }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: #1e293b !important; }
      .content-bg { background-color: #334155 !important; }
      .text-dark { color: #e2e8f0 !important; }
      .text-muted { color: #94a3b8 !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; background-color: #f1f5f9;">
  <!-- Preheader text (hidden but shows in email preview) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader || headerTitle}
    &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
  </div>
  
  <!-- Email wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f1f5f9;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        
        <!-- Main container -->
        <table role="presentation" class="container" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
          
          <!-- Logo bar -->
          <tr>
            <td style="padding: 20px 32px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td>
                    <a href="${appUrl}" style="text-decoration: none; display: inline-flex; align-items: center;">
                      <span style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.secondary} 100%); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px; font-weight: bold; color: white; margin-right: 12px;">D</span>
                      <span style="font-size: 24px; font-weight: 700; color: ${BRAND.dark};">Docta<span style="color: ${BRAND.secondary};">.</span></span>
                    </a>
                  </td>
                  <td align="right" style="color: ${BRAND.gray}; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    HIPAA Compliant
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td class="header-padding" style="background: linear-gradient(135deg, ${headerColor} 0%, ${headerColorEnd} 100%); padding: 48px 32px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">${headerIcon}</div>
              <h1 style="margin: 0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 28px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                ${headerTitle}
              </h1>
              ${headerSubtitle ? `<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; color: rgba(255,255,255,0.9);">${headerSubtitle}</p>` : ''}
            </td>
          </tr>
          
          <!-- Body content -->
          <tr>
            <td class="content-padding content-bg" style="padding: 40px 32px; background-color: #ffffff;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; line-height: 1.7; color: #334155;">
                ${bodyContent}
              </div>
              
              ${ctaButton ? `
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 32px;">
                <tr>
                  <td align="center">
                    <a href="${ctaButton.url}" class="cta-button" style="display: inline-block; background: linear-gradient(135deg, ${ctaButton.color || BRAND.primary} 0%, ${ctaButton.colorEnd || BRAND.primaryDark} 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 10px; box-shadow: 0 4px 14px 0 rgba(124, 58, 237, 0.39);">
                      ${ctaButton.text}
                    </a>
                  </td>
                </tr>
              </table>
              ` : ''}
              
              ${footerNote ? `
              <div style="margin-top: 32px; padding: 16px; background-color: #f8fafc; border-radius: 8px; border-left: 4px solid ${BRAND.secondary};">
                <p style="margin: 0; font-size: 14px; color: ${BRAND.gray};">
                  ${footerNote}
                </p>
              </div>
              ` : ''}
            </td>
          </tr>
          
          <!-- Signature -->
          <tr>
            <td style="padding: 0 32px 32px 32px; background-color: #ffffff;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; padding-top: 24px;">
                    <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; color: #334155;">
                      Best regards,<br>
                      <strong style="color: ${BRAND.primary};">The ${COMPANY.name} Team</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: ${BRAND.dark}; padding: 32px; text-align: center;">
              <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6;">
                ${COMPANY.fullName}<br>
                <a href="tel:${COMPANY.phone}" style="color: rgba(255,255,255,0.7); text-decoration: none;">${COMPANY.phone}</a> &nbsp;|&nbsp;
                <a href="mailto:${COMPANY.supportEmail}" style="color: rgba(255,255,255,0.7); text-decoration: none;">${COMPANY.supportEmail}</a>
              </p>
              
              <!-- Social links -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto 16px auto;">
                <tr>
                  <td style="padding: 0 8px;">
                    <a href="${appUrl}" style="color: rgba(255,255,255,0.7); text-decoration: none; font-size: 13px;">Website</a>
                  </td>
                  <td style="color: rgba(255,255,255,0.4);">|</td>
                  <td style="padding: 0 8px;">
                    <a href="${appUrl}/support" style="color: rgba(255,255,255,0.7); text-decoration: none; font-size: 13px;">Support</a>
                  </td>
                  <td style="color: rgba(255,255,255,0.4);">|</td>
                  <td style="padding: 0 8px;">
                    <a href="${appUrl}/privacy" style="color: rgba(255,255,255,0.7); text-decoration: none; font-size: 13px;">Privacy</a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: rgba(255,255,255,0.5);">
                © ${currentYear} ${COMPANY.name} All rights reserved.<br>
                This email was sent to ${recipientEmail || 'you'} because you have an account with ${COMPANY.name}
              </p>
              
              ${recipientEmail ? `
              <p style="margin: 16px 0 0 0;">
                <a href="${appUrl}/unsubscribe?email=${encodeURIComponent(recipientEmail)}" style="color: rgba(255,255,255,0.6); font-size: 12px; text-decoration: underline;">
                  Manage email preferences
                </a>
              </p>
              ` : ''}
            </td>
          </tr>
          
        </table>
        
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

/**
 * Generate plain text version of email
 */
const generatePlainText = (content) => {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
};

/**
 * Send email with enhanced headers for deliverability
 */
const sendEmail = async ({ to, subject, html, text, replyTo }) => {
  const fromName = process.env.SMTP_FROM_NAME || COMPANY.name;
  const fromEmail = process.env.SMTP_FROM || 'info@doctarx.com';
  
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html,
    text: text || generatePlainText(html),
    replyTo: replyTo || fromEmail,
    headers: {
      'X-Priority': '3',
      'X-Mailer': 'Docta Telehealth Platform',
      'List-Unsubscribe': `<${process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com'}/unsubscribe?email=${encodeURIComponent(to)}>`,
      'Precedence': 'bulk'
    }
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Send welcome email to new user
 */
const sendWelcomeEmail = async (user) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const roleName = user.role === 'provider' ? 'Healthcare Provider' : 'Patient';
    const dashboardUrl = `${appUrl}/${user.role === 'provider' ? 'provider' : 'patient'}/dashboard`;
    
    const features = user.role === 'provider' ? [
      { icon: '📅', title: 'Manage Your Schedule', desc: 'Set availability and manage appointments seamlessly' },
      { icon: '💬', title: 'Secure Messaging', desc: 'HIPAA-compliant communication with patients' },
      { icon: '📋', title: 'Clinical Documentation', desc: 'AI-assisted visit notes and prescriptions' },
      { icon: '💳', title: 'Billing & Claims', desc: 'Streamlined insurance claims processing' }
    ] : [
      { icon: '🩺', title: 'Virtual Visits', desc: 'Connect with providers from anywhere' },
      { icon: '📱', title: 'Easy Scheduling', desc: 'Book appointments in seconds' },
      { icon: '🔒', title: 'Secure Records', desc: 'Access your health records anytime' },
      { icon: '💊', title: 'Prescriptions', desc: 'Manage medications and refills easily' }
    ];

    const featuresHtml = features.map(f => `
      <tr>
        <td style="padding: 12px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="width: 50px; vertical-align: top;">
                <div style="width: 44px; height: 44px; background: linear-gradient(135deg, ${BRAND.secondary}20 0%, ${BRAND.primary}20 100%); border-radius: 10px; text-align: center; line-height: 44px; font-size: 20px;">
                  ${f.icon}
                </div>
              </td>
              <td style="padding-left: 12px; vertical-align: top;">
                <p style="margin: 0 0 4px 0; font-weight: 600; color: ${BRAND.dark};">${f.title}</p>
                <p style="margin: 0; font-size: 14px; color: ${BRAND.gray};">${f.desc}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `).join('');

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${user.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        Welcome to <strong style="color: ${BRAND.primary};">${COMPANY.name}</strong>! We're thrilled to have you join our modern telehealth platform as a <strong>${roleName}</strong>.
      </p>
      
      <div style="background: linear-gradient(135deg, ${BRAND.light} 0%, #ffffff 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid ${BRAND.lightGray};">
        <p style="margin: 0 0 16px 0; font-weight: 600; color: ${BRAND.dark}; font-size: 17px;">
          🎉 Here's what you can do with ${COMPANY.name}:
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${featuresHtml}
        </table>
      </div>
      
      <p style="margin: 24px 0;">
        Your account is ready! Click the button below to access your personalized dashboard and start exploring.
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: `Welcome to ${COMPANY.name}! Your ${roleName} account is ready.`,
      headerIcon: '🎉',
      headerTitle: `Welcome to ${COMPANY.name}!`,
      headerSubtitle: `Your ${roleName} journey starts here`,
      headerColor: BRAND.secondary,
      headerColorEnd: BRAND.primary,
      bodyContent,
      ctaButton: {
        text: 'Go to My Dashboard →',
        url: dashboardUrl,
        color: BRAND.secondary,
        colorEnd: BRAND.secondaryDark
      },
      footerNote: '💡 <strong>Pro tip:</strong> Complete your profile to get the most out of your experience. Add your photo, contact details, and preferences.',
      recipientEmail: user.email
    });

    await sendEmail({
      to: user.email,
      subject: `🎉 Welcome to ${COMPANY.name} - Let's Get Started!`,
      html
    });

    logger.info('Welcome email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send welcome email', { error: error.message, userId: user.id });
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
      day: 'numeric'
    });
    const formattedTime = scheduledDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const configs = {
      created: {
        icon: '📅',
        title: recipient.role === 'provider' ? 'New Appointment Scheduled' : 'Appointment Confirmed',
        color: BRAND.secondary,
        colorEnd: BRAND.secondaryDark,
        subject: recipient.role === 'provider' 
          ? `📅 New Appointment - ${appointment.patientFirstName} ${appointment.patientLastName}`
          : `✅ Appointment Confirmed - Dr. ${appointment.providerFirstName} ${appointment.providerLastName}`,
        message: recipient.role === 'provider'
          ? `A new appointment has been scheduled with <strong>${appointment.patientFirstName} ${appointment.patientLastName}</strong>.`
          : `Your appointment with <strong>Dr. ${appointment.providerFirstName} ${appointment.providerLastName}</strong> has been confirmed.`
      },
      reminder: {
        icon: '⏰',
        title: 'Appointment Reminder',
        color: BRAND.accent,
        colorEnd: '#d97706',
        subject: `⏰ Reminder: Appointment on ${formattedDate}`,
        message: recipient.role === 'provider'
          ? `Reminder: You have an upcoming appointment with <strong>${appointment.patientFirstName} ${appointment.patientLastName}</strong>.`
          : `Reminder: Your appointment with <strong>Dr. ${appointment.providerFirstName} ${appointment.providerLastName}</strong> is coming up soon.`
      },
      cancelled: {
        icon: '❌',
        title: 'Appointment Cancelled',
        color: '#dc2626',
        colorEnd: '#b91c1c',
        subject: '❌ Appointment Cancelled',
        message: recipient.role === 'provider'
          ? `The appointment with <strong>${appointment.patientFirstName} ${appointment.patientLastName}</strong> has been cancelled.`
          : `Your appointment with <strong>Dr. ${appointment.providerFirstName} ${appointment.providerLastName}</strong> has been cancelled.`
      },
      updated: {
        icon: '🔄',
        title: 'Appointment Updated',
        color: BRAND.primary,
        colorEnd: BRAND.primaryDark,
        subject: '🔄 Appointment Updated',
        message: 'Your appointment details have been updated. Please review the new information below.'
      }
    };

    const config = configs[type] || configs.updated;
    const actionUrl = type === 'cancelled' 
      ? `${appUrl}/${recipient.role}/appointments`
      : `${appUrl}/${recipient.role}/appointments/${appointment.id}`;

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${recipient.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        ${config.message}
      </p>
      
      <div style="background: ${BRAND.light}; border-radius: 12px; padding: 24px; margin: 24px 0; border-left: 4px solid ${config.color};">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: ${BRAND.gray}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Date</span><br>
              <span style="font-size: 16px; font-weight: 600; color: ${BRAND.dark};">📆 ${formattedDate}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: ${BRAND.gray}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Time</span><br>
              <span style="font-size: 16px; font-weight: 600; color: ${BRAND.dark};">🕐 ${formattedTime}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: ${BRAND.gray}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Duration</span><br>
              <span style="font-size: 16px; font-weight: 600; color: ${BRAND.dark};">⏱️ ${appointment.durationMinutes || 30} minutes</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: ${BRAND.gray}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Type</span><br>
              <span style="font-size: 16px; font-weight: 600; color: ${BRAND.dark};">💻 ${appointment.type === 'video' ? 'Video Consultation' : appointment.type}</span>
            </td>
          </tr>
          ${appointment.reasonForVisit ? `
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: ${BRAND.gray}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Reason</span><br>
              <span style="font-size: 16px; color: ${BRAND.dark};">📝 ${appointment.reasonForVisit}</span>
            </td>
          </tr>
          ` : ''}
        </table>
      </div>
    `;

    const html = generateEmailTemplate({
      preheader: config.message.replace(/<[^>]*>/g, ''),
      headerIcon: config.icon,
      headerTitle: config.title,
      headerColor: config.color,
      headerColorEnd: config.colorEnd,
      bodyContent,
      ctaButton: {
        text: type === 'cancelled' ? 'View All Appointments' : 'View Appointment Details',
        url: actionUrl,
        color: config.color,
        colorEnd: config.colorEnd
      },
      footerNote: type === 'reminder' ? '⚡ <strong>Quick tip:</strong> Test your camera and microphone before the appointment for the best experience.' : '',
      recipientEmail: recipient.email
    });

    await sendEmail({
      to: recipient.email,
      subject: config.subject,
      html
    });

    logger.info('Appointment notification sent', { appointmentId: appointment.id, recipientId: recipient.id, type });
  } catch (error) {
    logger.error('Failed to send appointment notification', { error: error.message, appointmentId: appointment.id });
  }
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (user, resetToken) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${user.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        We received a request to reset the password for your ${COMPANY.name} account. If you made this request, click the button below to set a new password.
      </p>
      
      <div style="background: #fef3c7; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid ${BRAND.accent};">
        <p style="margin: 0; font-size: 14px; color: #92400e;">
          ⚠️ <strong>Security Notice:</strong> This link will expire in <strong>1 hour</strong>. If you didn't request this reset, please ignore this email or contact support if you're concerned about your account security.
        </p>
      </div>
      
      <p style="margin: 24px 0 8px 0; font-size: 14px; color: ${BRAND.gray};">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin: 0; word-break: break-all; font-size: 12px; padding: 12px; background: ${BRAND.light}; border-radius: 6px; color: ${BRAND.primary};">
        ${resetUrl}
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: 'Reset your password for your DoctaRx account',
      headerIcon: '🔐',
      headerTitle: 'Reset Your Password',
      headerSubtitle: 'Secure password reset request',
      headerColor: BRAND.primary,
      headerColorEnd: BRAND.primaryDark,
      bodyContent,
      ctaButton: {
        text: 'Reset My Password →',
        url: resetUrl,
        color: BRAND.primary,
        colorEnd: BRAND.primaryDark
      },
      recipientEmail: user.email
    });

    await sendEmail({
      to: user.email,
      subject: `🔐 Reset Your Password - ${COMPANY.name}`,
      html
    });

    logger.info('Password reset email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send password reset email', { error: error.message, userId: user.id });
    throw error;
  }
};

/**
 * Send email verification email
 */
const sendVerificationEmail = async (user, verificationToken) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`;

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${user.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        Thank you for creating an account with ${COMPANY.name}! To complete your registration and access all features, please verify your email address.
      </p>
      
      <div style="background: linear-gradient(135deg, ${BRAND.secondary}10 0%, ${BRAND.primary}10 100%); border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center; border: 1px dashed ${BRAND.secondary};">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: ${BRAND.gray};">Click the button below to verify:</p>
        <p style="margin: 0; font-size: 13px; color: ${BRAND.gray};">This link expires in <strong>24 hours</strong></p>
      </div>
      
      <p style="margin: 24px 0 8px 0; font-size: 14px; color: ${BRAND.gray};">
        Or copy and paste this link:
      </p>
      <p style="margin: 0; word-break: break-all; font-size: 12px; padding: 12px; background: ${BRAND.light}; border-radius: 6px; color: ${BRAND.primary};">
        ${verificationUrl}
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: 'Please verify your email address to complete your registration',
      headerIcon: '✉️',
      headerTitle: 'Verify Your Email',
      headerSubtitle: 'One quick step to get started',
      headerColor: BRAND.secondary,
      headerColorEnd: BRAND.secondaryDark,
      bodyContent,
      ctaButton: {
        text: 'Verify My Email →',
        url: verificationUrl,
        color: BRAND.secondary,
        colorEnd: BRAND.secondaryDark
      },
      footerNote: 'If you didn\'t create an account with us, you can safely ignore this email.',
      recipientEmail: user.email
    });

    await sendEmail({
      to: user.email,
      subject: `✉️ Verify Your Email - ${COMPANY.name}`,
      html
    });

    logger.info('Verification email sent', { userId: user.id, email: user.email });
  } catch (error) {
    logger.error('Failed to send verification email', { error: error.message, userId: user.id });
    throw error;
  }
};

/**
 * Send admin message email to user
 */
const sendAdminMessage = async (recipient, subject, content, adminName) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const dashboardPath = recipient.role === 'provider' ? 'provider' : recipient.role === 'admin' ? 'admin' : 'patient';

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${recipient.first_name || recipient.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        You have received a message from the ${COMPANY.name} administration team.
      </p>
      
      <div style="background: ${BRAND.light}; border-radius: 12px; padding: 24px; margin: 24px 0; border-left: 4px solid ${BRAND.primary};">
        <p style="margin: 0 0 12px 0; font-weight: 600; color: ${BRAND.primary}; font-size: 18px;">
          ${subject}
        </p>
        <div style="font-size: 15px; color: ${BRAND.dark}; line-height: 1.7; white-space: pre-wrap;">
          ${content}
        </div>
      </div>
      
      <p style="margin: 24px 0 0 0; font-size: 14px; color: ${BRAND.gray};">
        This message was sent by <strong>${adminName}</strong> from the ${COMPANY.name} Admin team.
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: `Message from ${COMPANY.name} Admin: ${subject}`,
      headerIcon: '📨',
      headerTitle: 'Message from Admin',
      headerSubtitle: `From ${adminName}`,
      headerColor: BRAND.primary,
      headerColorEnd: BRAND.primaryDark,
      bodyContent,
      ctaButton: {
        text: 'View in Dashboard',
        url: `${appUrl}/${dashboardPath}/notifications`,
        color: BRAND.primary,
        colorEnd: BRAND.primaryDark
      },
      recipientEmail: recipient.email
    });

    await sendEmail({
      to: recipient.email,
      subject: `📨 [${COMPANY.name}] ${subject}`,
      html
    });

    logger.info('Admin message email sent', { recipientId: recipient.id, email: recipient.email, subject });
  } catch (error) {
    logger.error('Failed to send admin message email', { error: error.message, recipientId: recipient.id });
  }
};

/**
 * Send new message notification email
 */
const sendNewMessageEmail = async (recipient, senderName, isUrgent = false) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const dashboardPath = recipient.role === 'provider' ? 'provider' : 'patient';

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello <strong>${recipient.first_name || recipient.firstName}</strong>,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        You have a new ${isUrgent ? '<span style="color: #dc2626; font-weight: 600;">URGENT</span> ' : ''}message from <strong>${senderName}</strong> on ${COMPANY.name}.
      </p>
      
      ${isUrgent ? `
      <div style="background: #fef2f2; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #dc2626;">
        <p style="margin: 0; font-size: 14px; color: #991b1b;">
          🔴 <strong>This message is marked as urgent.</strong> Please respond as soon as possible.
        </p>
      </div>
      ` : ''}
      
      <p style="margin: 24px 0; font-size: 14px; color: ${BRAND.gray};">
        🔒 For your privacy and HIPAA compliance, message content is not included in this email. Please log in to view your messages securely.
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: `${isUrgent ? '[URGENT] ' : ''}New message from ${senderName}`,
      headerIcon: isUrgent ? '🔴' : '💬',
      headerTitle: isUrgent ? 'Urgent Message' : 'New Message',
      headerSubtitle: `From ${senderName}`,
      headerColor: isUrgent ? '#dc2626' : BRAND.primary,
      headerColorEnd: isUrgent ? '#b91c1c' : BRAND.primaryDark,
      bodyContent,
      ctaButton: {
        text: 'View Message →',
        url: `${appUrl}/${dashboardPath}/messages`,
        color: isUrgent ? '#dc2626' : BRAND.primary,
        colorEnd: isUrgent ? '#b91c1c' : BRAND.primaryDark
      },
      recipientEmail: recipient.email
    });

    await sendEmail({
      to: recipient.email,
      subject: isUrgent ? `🔴 [Urgent] New message from ${senderName}` : `💬 New message from ${senderName} - ${COMPANY.name}`,
      html
    });

    logger.info('New message notification sent', { recipientId: recipient.id, senderName, isUrgent });
  } catch (error) {
    logger.error('Failed to send new message email', { error: error.message, recipientId: recipient.id });
  }
};

/**
 * Send provider invitation email
 */
const sendProviderInvitationEmail = async (email, inviteToken, inviterName) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    const inviteUrl = `${appUrl}/provider/register?token=${inviteToken}`;

    const bodyContent = `
      <p style="margin: 0 0 24px 0; font-size: 18px;">
        Hello,
      </p>
      
      <p style="margin: 0 0 24px 0;">
        <strong>${inviterName}</strong> has invited you to join <strong style="color: ${BRAND.primary};">${COMPANY.name}</strong> as a Healthcare Provider!
      </p>
      
      <div style="background: linear-gradient(135deg, ${BRAND.secondary}10 0%, ${BRAND.primary}10 100%); border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid ${BRAND.lightGray};">
        <p style="margin: 0 0 16px 0; font-weight: 600; color: ${BRAND.dark}; font-size: 17px;">
          🏥 As a ${COMPANY.name} Provider, you'll have access to:
        </p>
        <ul style="margin: 0; padding-left: 20px; color: ${BRAND.dark};">
          <li style="margin-bottom: 8px;">📹 HD Video consultations with patients</li>
          <li style="margin-bottom: 8px;">📋 AI-powered clinical documentation</li>
          <li style="margin-bottom: 8px;">💊 Electronic prescribing (eRx)</li>
          <li style="margin-bottom: 8px;">💳 Integrated billing and claims</li>
          <li style="margin-bottom: 8px;">📊 Practice analytics dashboard</li>
        </ul>
      </div>
      
      <p style="margin: 24px 0; font-size: 14px; color: ${BRAND.gray};">
        This invitation expires in <strong>7 days</strong>. Click below to create your provider account.
      </p>
    `;

    const html = generateEmailTemplate({
      preheader: `You've been invited to join ${COMPANY.name} as a Healthcare Provider`,
      headerIcon: '🩺',
      headerTitle: 'You\'re Invited!',
      headerSubtitle: 'Join our provider network',
      headerColor: BRAND.secondary,
      headerColorEnd: BRAND.primary,
      bodyContent,
      ctaButton: {
        text: 'Accept Invitation →',
        url: inviteUrl,
        color: BRAND.secondary,
        colorEnd: BRAND.secondaryDark
      },
      recipientEmail: email
    });

    await sendEmail({
      to: email,
      subject: `🩺 You're Invited to Join ${COMPANY.name} as a Provider!`,
      html
    });

    logger.info('Provider invitation email sent', { email });
  } catch (error) {
    logger.error('Failed to send provider invitation email', { error: error.message, email });
    throw error;
  }
};

/**
 * Send ops/alert email (webhooks, readiness, critical failures)
 */
const sendOpsAlertEmail = async ({ subject, html, text, metadata }) => {
  try {
    const to = process.env.ALERT_ADMIN_EMAIL || 'evolvedu@outlook.com';
    const safeSubject = subject?.slice(0, 200) || 'DoctaRx Ops Alert';

    const bodyHtml = html || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <div style="background: #dc2626; color: white; padding: 20px; border-radius: 12px 12px 0 0;">
          <h2 style="margin: 0;">⚠️ ${safeSubject}</h2>
        </div>
        <div style="background: #1e1b4b; padding: 20px; border-radius: 0 0 12px 12px;">
          <pre style="background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.5;">${(text || '').replace(/</g, '&lt;')}</pre>
          ${metadata ? `
          <div style="margin-top: 16px;">
            <p style="color: #94a3b8; margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase;">Metadata</p>
            <pre style="background: #334155; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px;">${JSON.stringify(metadata, null, 2)}</pre>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'info@doctarx.com',
      to,
      subject: `⚠️ [${COMPANY.name} ALERT] ${safeSubject}`,
      html: bodyHtml,
      text: text || undefined
    });

    logger.info('Ops alert email sent', { to, subject: safeSubject });
  } catch (error) {
    logger.error('Failed to send ops alert email', { error: error.message, subject });
  }
};

/**
 * Send a personalized email from Nova (AI health concierge)
 * Distinctive design that makes it clear this is a personal message from Nova.
 */
const sendNovaEmail = async ({ to, recipientName, role, subject, message, ctaText, ctaUrl }) => {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';

    const bodyContent = `
      <p style="margin: 0 0 20px 0; font-size: 17px; font-weight: 600; color: #1e1b4b;">
        Hi ${recipientName},
      </p>

      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.75; color: #334155;">
        ${message}
      </p>

      <div style="background: linear-gradient(135deg, #ede9fe 0%, #d1fae5 100%); border-radius: 14px; padding: 20px 24px; margin: 0 0 24px 0; border: 1px solid #c4b5fd;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="width: 44px; vertical-align: top; padding-right: 14px;">
              <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #7c3aed 0%, #10b981 100%); border-radius: 50%; text-align: center; line-height: 44px; font-size: 20px;">
                🤖
              </div>
            </td>
            <td style="vertical-align: middle;">
              <p style="margin: 0; font-size: 13px; font-weight: 700; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.05em;">Nova · AI Health Concierge</p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #6d28d9;">DoctaRx · doctarx.com</p>
            </td>
          </tr>
        </table>
      </div>
    `;

    const html = generateEmailTemplate({
      preheader: message.slice(0, 90),
      headerIcon: '🤖',
      headerTitle: 'A message from Nova',
      headerSubtitle: `Your personal AI health concierge at DoctaRx`,
      headerColor: '#5b21b6',
      headerColorEnd: '#10b981',
      bodyContent,
      ctaButton: ctaText && ctaUrl ? {
        text: ctaText,
        url: ctaUrl,
        color: '#7c3aed',
        colorEnd: '#5b21b6'
      } : null,
      footerNote: '✨ Nova is DoctaRx\'s AI health concierge. She learns your preferences over time to give you a more personal experience.',
      recipientEmail: to
    });

    await sendEmail({ to, subject: subject || `A message from Nova — DoctaRx`, html });
    logger.info('Nova email sent', { to });
  } catch (error) {
    logger.error('Failed to send Nova email', { error: error.message, to });
    throw error;
  }
};

module.exports = {
  sendWelcomeEmail,
  sendAppointmentNotification,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendAdminMessage,
  sendNewMessageEmail,
  sendProviderInvitationEmail,
  sendOpsAlertEmail,
  sendNovaEmail,
  // Export for advanced use
  sendEmail,
  generateEmailTemplate
};
