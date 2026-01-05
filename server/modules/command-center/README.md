# Communication Command Center Module

## Architecture Overview

The Communication Command Center is a HIPAA-compliant mini-CRM/Marketing automation system for healthcare administrators. It provides email management, multi-channel AI assistance, social media management, and campaign automation.

## Folder Structure

```
server/modules/command-center/
├── README.md
├── types/
│   ├── index.js                    # Type definitions (JSDoc)
│   ├── email.types.js              # Email-related types
│   ├── social.types.js             # Social media types
│   ├── campaign.types.js           # Campaign types
│   └── ai.types.js                 # AI/HealthBot types
├── services/
│   ├── email/
│   │   ├── index.js                # Email service factory
│   │   ├── EmailProvider.js        # Abstract base class
│   │   ├── providers/
│   │   │   ├── AWSSESProvider.js   # AWS SES implementation
│   │   │   ├── SendGridProvider.js # SendGrid implementation
│   │   │   └── MailgunProvider.js  # Mailgun implementation
│   │   ├── InboxService.js         # Inbox/Thread management
│   │   └── TrackingService.js      # Open/click tracking
│   ├── social/
│   │   ├── index.js                # Social service factory
│   │   ├── SocialProvider.js       # Abstract base class
│   │   ├── providers/
│   │   │   ├── LinkedInProvider.js
│   │   │   ├── TwitterProvider.js
│   │   │   ├── FacebookProvider.js
│   │   │   └── InstagramProvider.js
│   │   └── ConnectionManager.js    # OAuth token management
│   ├── campaign/
│   │   ├── CampaignService.js      # Campaign orchestration
│   │   ├── SegmentationService.js  # User segmentation
│   │   └── AnalyticsService.js     # Campaign analytics
│   ├── queue/
│   │   ├── QueueService.js         # BullMQ wrapper
│   │   ├── processors/
│   │   │   ├── emailProcessor.js   # Email job processor
│   │   │   ├── socialProcessor.js  # Social post processor
│   │   │   └── campaignProcessor.js
│   │   └── jobs/
│   │       ├── sendEmail.job.js
│   │       └── publishPost.job.js
│   └── ai/
│       ├── HealthBotService.js     # Main AI orchestrator
│       ├── PHIRedactor.js          # PII/PHI redaction
│       ├── SentimentAnalyzer.js    # Message sentiment
│       ├── ContentGenerator.js     # Email/post generation
│       └── RAGService.js           # Knowledge base retrieval
├── routes/
│   ├── inbox.routes.js             # Inbox API endpoints
│   ├── social.routes.js            # Social media endpoints
│   ├── campaign.routes.js          # Campaign endpoints
│   └── healthbot.routes.js         # AI assistant endpoints
├── middleware/
│   ├── campaignAuth.js             # Campaign-specific auth
│   └── rateLimiter.js              # API rate limiting
└── utils/
    ├── encryption.js               # PHI encryption helpers
    └── validators.js               # Input validation schemas

app/(dashboard)/admin/
├── command-center/
│   ├── layout.js                   # Command center layout
│   ├── page.js                     # Dashboard/overview
│   ├── inbox/
│   │   └── page.js                 # Unified inbox UI
│   ├── social/
│   │   └── page.js                 # Social media manager
│   ├── campaigns/
│   │   ├── page.js                 # Campaign list
│   │   └── [id]/
│   │       └── page.js             # Campaign detail/editor
│   └── healthbot/
│       └── page.js                 # AI assistant chat
```

## Security & Compliance

### HIPAA Compliance
- All PHI encrypted at rest using AES-256-GCM
- TLS 1.3 for data in transit
- PHI redaction before sending to external LLMs
- Audit logging for all PHI access
- BAA required with all third-party providers

### RBAC Permissions
- `admin.command_center.view` - View inbox, campaigns
- `admin.command_center.manage` - Create/edit campaigns
- `admin.command_center.send` - Send campaigns
- `admin.command_center.social` - Social media access
- `admin.command_center.ai` - HealthBot access

## Queue Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Campaign       │────►│  Redis/      │────►│  Job Processors │
│  Manager        │     │  BullMQ      │     │                 │
└─────────────────┘     └──────────────┘     └─────────────────┘
                              │                      │
                              │                      ▼
                              │              ┌───────────────┐
                              └─────────────►│ Email/Social  │
                                             │ Providers     │
                                             └───────────────┘
```

## Environment Variables

```env
# Email Providers
EMAIL_PROVIDER=ses|sendgrid|mailgun
AWS_SES_ACCESS_KEY=
AWS_SES_SECRET_KEY=
AWS_SES_REGION=
SENDGRID_API_KEY=
MAILGUN_API_KEY=
MAILGUN_DOMAIN=

# Social Media OAuth
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=

# Redis/Queue
REDIS_URL=redis://localhost:6379
QUEUE_CONCURRENCY=5

# AI
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_PROVIDER=openai|anthropic

# Tracking
TRACKING_DOMAIN=track.yourdomain.com
```

