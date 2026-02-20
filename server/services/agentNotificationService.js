/**
 * Nova Agent Notification Service
 * DoctaRx's AI health concierge — learns each user over time
 * and sends warm, personal notifications and emails.
 *
 * Nova is NOT a generic bot. She remembers users, references context,
 * and grows more personal with every interaction.
 */

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const logger = require('../middleware/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Nova's Personality ────────────────────────────────────────────────────
const NOVA_SYSTEM_PROMPT = `You are Nova, DoctaRx's warm and caring AI health concierge.

Your personality:
- Genuine and empathetic — like a knowledgeable friend who truly cares
- Concise: 2-3 sentences for in-app notifications, 4-5 sentences for emails
- Specific: always use the person's first name and reference their real context
- Never generic: never say "I hope this finds you well" or "We wanted to reach out"
- For patients: focus on health, ease of care, peace of mind
- For providers: focus on their clinical mission and their patients

You speak as "Nova" in first person. Write ONLY the message body — no subject line,
no greeting like "Dear X", no sign-off. Those are added by the template.`;

// ─── Fallback messages when Claude is unavailable ──────────────────────────
const FALLBACKS = {
  welcome_patient: (ctx) =>
    `Welcome to DoctaRx, ${ctx.firstName}! I'm Nova — I'll be your personal health guide here. Whether you're booking a visit or tracking your health, I've got you.`,
  welcome_provider: (ctx) =>
    `Welcome to DoctaRx, Dr. ${ctx.lastName || ctx.firstName}! I'm Nova. I'm here to help your practice run smoothly — from managing your schedule to keeping your patients engaged.`,
  appointment_reminder: (ctx) =>
    `Hey ${ctx.firstName} — just a friendly heads-up: your appointment is coming up soon. Make sure you're in a quiet spot with a good connection. See you there!`,
  check_in: (ctx) =>
    `Hey ${ctx.firstName}, Nova here. Just checking in — how are you doing? I'm always here if you need help with your care.`,
  verify_email: (ctx) =>
    `${ctx.firstName}, one quick step — verify your email so your DoctaRx account is fully secured and you never miss an important health update from us.`
};

// ─── Nova Profile Table ────────────────────────────────────────────────────
async function ensureNovaProfileTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS nova_user_profiles (
        user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        known_facts   JSONB    DEFAULT '[]'::jsonb,
        last_contact  TIMESTAMP WITH TIME ZONE,
        message_count INTEGER  DEFAULT 0,
        onboarding_done BOOLEAN DEFAULT false,
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } catch (err) {
    logger.warn('Nova: profile table note:', err.message);
  }
}

// ─── Build User Context ────────────────────────────────────────────────────
async function getUserContext(userId) {
  try {
    const { rows } = await db.query(`
      SELECT u.first_name, u.last_name, u.role, u.specialty,
             u.city, u.state, u.created_at,
             COUNT(a.id)::int          AS appointment_count,
             MAX(a.scheduled_at)       AS last_appointment_at
      FROM users u
      LEFT JOIN appointments a
        ON (a.patient_id = u.id OR a.provider_id = u.id)
      WHERE u.id = $1
      GROUP BY u.id
    `, [userId]);

    if (!rows.length) return null;
    const u = rows[0];

    const { rows: profiles } = await db.query(
      'SELECT known_facts, message_count FROM nova_user_profiles WHERE user_id = $1',
      [userId]
    );
    const prof = profiles[0] || { known_facts: [], message_count: 0 };

    return {
      firstName:        u.first_name,
      lastName:         u.last_name,
      role:             u.role,
      specialty:        u.specialty,
      city:             u.city,
      state:            u.state,
      appointmentCount: u.appointment_count || 0,
      lastAppointmentAt: u.last_appointment_at,
      memberSince:      u.created_at,
      knownFacts:       prof.known_facts || [],
      messageCount:     prof.message_count || 0
    };
  } catch (err) {
    logger.warn('Nova: getUserContext error', err.message);
    return null;
  }
}

// ─── Record in Nova Profile ────────────────────────────────────────────────
async function touchNovaProfile(userId, newFact = null) {
  try {
    await ensureNovaProfileTable();
    if (newFact) {
      await db.query(`
        INSERT INTO nova_user_profiles (user_id, known_facts, message_count, last_contact, updated_at)
        VALUES ($1, $2::jsonb, 1, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          known_facts   = (nova_user_profiles.known_facts || $2::jsonb),
          message_count = nova_user_profiles.message_count + 1,
          last_contact  = NOW(),
          updated_at    = NOW()
      `, [userId, JSON.stringify([newFact])]);
    } else {
      await db.query(`
        INSERT INTO nova_user_profiles (user_id, message_count, last_contact, updated_at)
        VALUES ($1, 1, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          message_count = nova_user_profiles.message_count + 1,
          last_contact  = NOW(),
          updated_at    = NOW()
      `, [userId]);
    }
  } catch (err) {
    logger.warn('Nova: touchNovaProfile error', err.message);
  }
}

// ─── Core: Generate a Message via Claude ──────────────────────────────────
async function generateNovaMessage(context, event) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return (FALLBACKS[event.type]?.(context)) ||
      `Hi ${context?.firstName || 'there'}, Nova here from DoctaRx. Hope you're doing well!`;
  }

  try {
    const contextLines = [
      `First name: ${context.firstName}`,
      `Last name: ${context.lastName}`,
      `Role: ${context.role}`,
      context.specialty       ? `Specialty: ${context.specialty}` : '',
      context.city            ? `Location: ${context.city}${context.state ? ', ' + context.state : ''}` : '',
      `Total appointments: ${context.appointmentCount}`,
      context.knownFacts?.length
        ? `Things Nova already knows: ${context.knownFacts.slice(-3).join('; ')}`
        : '',
      `Times Nova has reached out before: ${context.messageCount}`
    ].filter(Boolean).join('\n');

    const resp = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     NOVA_SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `Occasion: ${event.description}\nContext:\n${contextLines}\nTone: ${event.tone || 'warm and genuine'}\nLength: ${event.length || '2-3 sentences'}`
      }]
    });

    return resp.content[0].text.trim();
  } catch (err) {
    logger.warn('Nova: Claude call failed, using fallback', err.message);
    return (FALLBACKS[event.type]?.(context)) ||
      `Hi ${context?.firstName || 'there'}, Nova here from DoctaRx. Hope you're doing well!`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Called immediately after registration.
 * Nova introduces herself and makes the new user feel seen.
 */
async function sendWelcomeFromNova(user) {
  try {
    await ensureNovaProfileTable();

    const notificationService = require('./notifications');
    const emailService        = require('./email');

    const context = {
      firstName:        user.firstName || user.first_name,
      lastName:         user.lastName  || user.last_name,
      role:             user.role,
      specialty:        user.specialty || null,
      appointmentCount: 0,
      knownFacts:       [],
      messageCount:     0
    };

    const eventType = user.role === 'provider' ? 'welcome_provider' : 'welcome_patient';

    const message = await generateNovaMessage(context, {
      type:        eventType,
      description: `First-ever message to a brand-new ${user.role}. Introduce yourself as Nova, express genuine excitement about their arrival, and reassure them you'll be here every step of the way. Make them feel like they joined something special.`,
      tone:        'warm, personal, genuinely excited',
      length:      '2-3 sentences'
    });

    // In-app notification
    await notificationService.createNotification({
      userId:     user.id,
      type:       'system',
      title:      `👋 Hi ${context.firstName}, I'm Nova — your DoctaRx guide`,
      message,
      actionUrl:  `/${user.role === 'provider' ? 'provider' : 'patient'}/dashboard`,
      actionText: 'Open Dashboard'
    });

    // Email (fire-and-forget — never block registration)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    emailService.sendNovaEmail({
      to:            user.email,
      recipientName: context.firstName,
      role:          user.role,
      subject:       `👋 Nova here — welcome to DoctaRx, ${context.firstName}!`,
      message,
      ctaText:       'Open My Dashboard',
      ctaUrl:        `${appUrl}/${user.role === 'provider' ? 'provider' : 'patient'}/dashboard`
    }).catch(err => logger.warn('Nova: welcome email failed (non-fatal)', err.message));

    // Save onboarding fact
    await db.query(`
      INSERT INTO nova_user_profiles
        (user_id, known_facts, message_count, last_contact, onboarding_done)
      VALUES ($1, $2::jsonb, 1, NOW(), true)
      ON CONFLICT (user_id) DO UPDATE SET
        onboarding_done = true,
        message_count   = nova_user_profiles.message_count + 1,
        last_contact    = NOW(),
        known_facts     = (nova_user_profiles.known_facts || $2::jsonb)
    `, [user.id, JSON.stringify([`Joined DoctaRx as ${user.role} on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`])]);

    logger.info('Nova: welcome message sent', { userId: user.id, role: user.role });
  } catch (err) {
    logger.warn('Nova: sendWelcomeFromNova error (non-fatal)', err.message);
  }
}

/**
 * Personal appointment reminder from Nova.
 * More personal than generic system reminders.
 */
async function sendAppointmentReminderFromNova(appointment, userId) {
  try {
    const context = await getUserContext(userId);
    if (!context) return;

    const apptDate      = new Date(appointment.scheduledAt || appointment.scheduled_at);
    const formattedDate = apptDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const formattedTime = apptDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const message = await generateNovaMessage(context, {
      type:        'appointment_reminder',
      description: `Appointment reminder for ${formattedDate} at ${formattedTime}.${appointment.type ? ' Visit type: ' + appointment.type + '.' : ''}${appointment.reason_for_visit ? ' Reason: ' + appointment.reason_for_visit + '.' : ''} Make it feel warm and reassuring — the user should feel prepared and at ease.`,
      tone:        'friendly, calm, reassuring',
      length:      '2-3 sentences'
    });

    const notificationService = require('./notifications');
    await notificationService.createNotification({
      userId,
      type:       'appointment',
      title:      `⏰ Nova's reminder — ${formattedDate} at ${formattedTime}`,
      message,
      actionUrl:  context.role === 'provider' ? '/provider/schedule' : '/patient/appointments',
      actionText: 'View Details'
    });

    await touchNovaProfile(userId, `Had appointment on ${formattedDate}`);
    logger.info('Nova: appointment reminder sent', { userId });
  } catch (err) {
    logger.warn('Nova: sendAppointmentReminderFromNova error (non-fatal)', err.message);
  }
}

/**
 * Periodic check-in. Called when a user loads their dashboard
 * if Nova hasn't reached out in 3+ days.
 * Nova grows more personalized as she learns more.
 */
async function sendCheckInFromNova(userId) {
  try {
    await ensureNovaProfileTable();
    const context = await getUserContext(userId);
    if (!context) return;

    // Throttle: once every 3 days max
    const { rows } = await db.query(
      'SELECT last_contact FROM nova_user_profiles WHERE user_id = $1',
      [userId]
    );
    if (rows.length && rows[0].last_contact) {
      const hours = (Date.now() - new Date(rows[0].last_contact)) / 3_600_000;
      if (hours < 72) return;
    }

    const message = await generateNovaMessage(context, {
      type:        'check_in',
      description: `Friendly check-in. ${context.appointmentCount > 0
        ? `They have had ${context.appointmentCount} appointment(s). Reference their journey subtly.`
        : "They haven't booked any appointments yet — gently encourage their first visit."
      } Keep it brief and genuinely caring. Never feel like a marketing message.`,
      tone:        'genuinely caring, brief, human',
      length:      '1-2 sentences'
    });

    const notificationService = require('./notifications');
    await notificationService.createNotification({
      userId,
      type:       'system',
      title:      '💙 Nova is checking in',
      message,
      actionUrl:  context.role === 'provider' ? '/provider/dashboard' : '/patient/appointments/book',
      actionText: context.appointmentCount === 0 ? 'Book Your First Visit' : 'View Dashboard'
    });

    await touchNovaProfile(userId);
    logger.info('Nova: check-in sent', { userId });
  } catch (err) {
    logger.warn('Nova: sendCheckInFromNova error (non-fatal)', err.message);
  }
}

/**
 * Teach Nova something new about a user (called from any route that has fresh context).
 * Example: learnAboutUser(userId, 'Prefers morning appointments')
 */
async function learnAboutUser(userId, fact) {
  await touchNovaProfile(userId, fact);
}

module.exports = {
  sendWelcomeFromNova,
  sendAppointmentReminderFromNova,
  sendCheckInFromNova,
  learnAboutUser
};
