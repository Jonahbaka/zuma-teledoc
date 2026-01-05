/**
 * Contact Form API Routes
 * Handles contact form submissions and sends emails to admin
 */

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');
const { z } = require('zod');

// Contact form validation schema
const contactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  subject: z.string().min(5).max(200),
  message: z.string().min(10).max(5000),
  type: z.enum(['general', 'support', 'enterprise', 'partnership', 'billing']).default('general')
});

// Admin email for receiving contact form submissions
const ADMIN_EMAIL = 'evolvedu@outlook.com';

// Create email transporter
const createTransporter = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }
  
  // Development mode - log instead of sending
  return {
    sendMail: async (options) => {
      logger.info('Contact form email (dev mode)', {
        to: options.to,
        subject: options.subject,
        from: options.replyTo
      });
      return { messageId: 'dev-' + Date.now() };
    }
  };
};

const transporter = createTransporter();

/**
 * POST /api/contact
 * Submit contact form
 */
router.post('/', async (req, res) => {
  try {
    // Validate input
    const data = contactSchema.parse(req.body);
    
    // Get type label
    const typeLabels = {
      general: 'General Inquiry',
      support: 'Technical Support',
      enterprise: 'Enterprise Solutions',
      partnership: 'Partnership Opportunity',
      billing: 'Billing Question'
    };
    
    const typeLabel = typeLabels[data.type] || 'General Inquiry';
    
    // Build email HTML
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>New Contact Form Submission</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">New Contact Form Submission</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">${typeLabel}</p>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><strong>From:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${data.name}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><strong>Email:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${data.email}">${data.email}</a></td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><strong>Type:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${typeLabel}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><strong>Subject:</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${data.subject}</td>
              </tr>
            </table>
            
            <div style="margin-top: 20px;">
              <strong>Message:</strong>
              <div style="background: white; padding: 15px; border-radius: 8px; margin-top: 10px; border: 1px solid #e5e7eb; white-space: pre-wrap;">${data.message}</div>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
              <a href="mailto:${data.email}?subject=Re: ${encodeURIComponent(data.subject)}" 
                 style="background: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reply to ${data.name}
              </a>
            </div>
          </div>
          <p style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px;">
            This email was sent from the Docta. contact form at ${new Date().toLocaleString()}
          </p>
        </body>
      </html>
    `;
    
    // Send email to admin
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: ADMIN_EMAIL,
      replyTo: data.email,
      subject: `[Docta. ${typeLabel}] ${data.subject}`,
      html
    });
    
    // Also send auto-reply to user
    const autoReplyHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Thank you for contacting Docta.</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Thank You!</h1>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
            <p>Dear ${data.name},</p>
            <p>Thank you for reaching out to Docta. We have received your message and will get back to you within 24 hours.</p>
            <p><strong>Your inquiry:</strong></p>
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #e5e7eb;">
              <p><strong>Subject:</strong> ${data.subject}</p>
              <p style="white-space: pre-wrap;">${data.message}</p>
            </div>
            <p>If you have any urgent concerns, please don't hesitate to reach out directly at <a href="mailto:evolvedu@outlook.com">evolvedu@outlook.com</a>.</p>
            <p>Best regards,<br>The Docta. Team</p>
          </div>
        </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@doctarx.com',
      to: data.email,
      subject: 'Thank you for contacting Docta.',
      html: autoReplyHtml
    });
    
    logger.info('Contact form submitted', { 
      from: data.email, 
      type: data.type, 
      subject: data.subject 
    });
    
    res.status(200).json({
      success: true,
      message: 'Message sent successfully'
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid form data',
        details: error.errors
      });
    }
    
    logger.error('Contact form error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to send message. Please try again.'
    });
  }
});

module.exports = router;

