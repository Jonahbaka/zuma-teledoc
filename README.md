# ZumaTeledocAI - Production Telehealth Platform

A fully production-ready, HIPAA-compliant, multi-portal telehealth system built with React, Next.js 15, PostgreSQL, Express.js, and Tailwind CSS.

## 🏥 Overview

ZumaTeledocAI is a modern telehealth platform that connects patients with healthcare providers through secure video consultations, encrypted messaging, and comprehensive health record management.

### Key Features

- **Multi-Portal System**: Separate portals for Patients, Providers, and Administrators
- **HIPAA Compliance**: Full audit logging, PHI encryption, and access controls
- **Secure Authentication**: JWT with refresh tokens, MFA support, and role-based access
- **Video Consultations**: Real-time video appointments with waiting room management
- **Encrypted Records**: AES-256-GCM encryption for all sensitive health data
- **SOAP Notes**: Complete clinical documentation system for providers
- **Subscription Management**: Tiered plans (Free, Gold, Platinum)

## 🛠 Tech Stack

- **Frontend**: React 18, Next.js 15, Tailwind CSS, shadcn/ui
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL (Aiven Cloud)
- **Authentication**: JWT, bcrypt, Speakeasy (MFA)
- **Encryption**: AES-256-GCM via Node.js crypto
- **Validation**: Zod
- **HTTP Client**: Axios
- **Logging**: Winston
- **Forms**: React Hook Form

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL database (connection details provided)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd zuma-teledoc
npm install
```

### 2. Environment Setup

Environment files are intentionally not committed. Use the examples in `config/` to create your own:

- `config/env.local.example` → copy to `.env.local` (local dev)
- `config/env.production.example` → copy to `.env.production` (production)

```env
DATABASE_URL=postgres://user:pass@host:port/db?sslmode=require
JWT_ACCESS_SECRET=your-64-char-secret
JWT_REFRESH_SECRET=your-64-char-secret
ENCRYPTION_KEY=your-32-byte-key
```

### 3. Run Database Migrations

```bash
npm run migrate
```

### 4. Start Development Servers

```bash
npm run dev
```

This starts:
- Next.js frontend on `http://localhost:3000`
- Express API server on `http://localhost:3001`

## 📁 Project Structure

```
zuma-teledoc/
├── app/                    # Next.js 15 App Router
│   ├── (auth)/            # Authentication pages
│   │   ├── login/
│   │   └── register/
│   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── patient/       # Patient portal
│   │   ├── provider/      # Provider portal
│   │   └── admin/         # Admin portal
│   ├── layout.js
│   ├── page.js            # Landing page
│   └── globals.css
├── components/
│   ├── layouts/           # Dashboard layouts
│   ├── providers/         # React context providers
│   └── ui/                # Reusable UI components
├── lib/
│   ├── api.js             # API client with interceptors
│   ├── encryption.js      # PHI encryption utilities
│   ├── utils.js           # Helper functions
│   └── validation.js      # Zod schemas
├── server/
│   ├── db/               # Database connection & migrations
│   ├── middleware/       # Express middleware
│   │   ├── auth.js       # JWT authentication
│   │   ├── audit.js      # HIPAA audit logging
│   │   └── logger.js     # Winston logger
│   ├── routes/           # API routes
│   │   ├── auth.js       # Authentication
│   │   ├── users.js      # User management
│   │   ├── appointments.js
│   │   ├── medicalRecords.js
│   │   ├── messages.js
│   │   ├── notifications.js
│   │   ├── providers.js
│   │   ├── visits.js     # SOAP notes
│   │   └── admin.js      # Admin operations
│   └── index.js          # Express server
└── package.json
```

## 🔐 Security Features

### Authentication
- JWT access tokens (15 min expiry)
- Refresh token rotation (7 day expiry)
- httpOnly secure cookies
- Password hashing with bcrypt (12 rounds)
- Account lockout after 5 failed attempts

### MFA (Multi-Factor Authentication)
- TOTP-based authentication
- QR code setup
- Backup recovery codes

### Encryption
- AES-256-GCM for PHI encryption
- Encrypted fields: medical records, SOAP notes, messages
- Secure key management

### HIPAA Compliance
- Complete audit trail for PHI access
- Session timeout
- Role-based access control
- Data export capabilities
- Consent management

## 📊 Database Schema

### Core Tables
- `users` - User accounts with RBAC
- `appointments` - Scheduling and management
- `medical_records` - Encrypted health records
- `visits` - SOAP notes (encrypted)
- `messages` - E2E encrypted messaging
- `notifications` - User notifications
- `subscriptions` - Zuma Gold/Platinum plans
- `audit_logs` - HIPAA compliance logs
- `refresh_tokens` - Token management
- `provider_schedules` - Availability management
- `provider_time_off` - Time off tracking

## 🌐 API Endpoints

### Authentication
```
POST /api/auth/register   - Create new account
POST /api/auth/login      - User login
POST /api/auth/logout     - User logout
POST /api/auth/refresh    - Refresh tokens
GET  /api/auth/me         - Get current user
POST /api/auth/mfa/setup  - Enable MFA
POST /api/auth/mfa/verify - Verify MFA code
```

### Appointments
```
GET    /api/appointments           - List appointments
POST   /api/appointments           - Create appointment
GET    /api/appointments/:id       - Get appointment details
PUT    /api/appointments/:id       - Update appointment
POST   /api/appointments/:id/cancel - Cancel appointment
POST   /api/appointments/:id/join   - Get video room info
```

### Medical Records
```
POST   /api/medical-records              - Create record
GET    /api/medical-records/patient/:id  - Get patient records
GET    /api/medical-records/:id          - Get record (decrypted)
PUT    /api/medical-records/:id          - Update record
DELETE /api/medical-records/:id          - Delete record
GET    /api/medical-records/export/:id   - Export patient data
```

### Providers
```
GET  /api/providers                  - List providers
GET  /api/providers/:id              - Get provider details
GET  /api/providers/:id/availability - Get available slots
GET  /api/providers/me/schedule      - Get own schedule
PUT  /api/providers/me/schedule      - Update schedule
GET  /api/providers/me/waiting-room  - Today's appointments
```

### Admin
```
GET  /api/admin/dashboard            - Dashboard stats
GET  /api/admin/users                - List users
PUT  /api/admin/users/:id/status     - Update user status
GET  /api/admin/providers/pending    - Pending approvals
GET  /api/admin/audit-logs           - View audit logs
GET  /api/admin/analytics/*          - Analytics data
```

## 🎨 User Portals

### Patient Portal
- Dashboard with health overview
- Appointment booking and management
- Encrypted health records access
- Secure messaging with providers
- Billing and subscription management

### Provider Portal
- Virtual waiting room
- Schedule management
- Patient charts
- SOAP notes editor
- Clinical documentation

### Admin Portal
- Platform dashboard
- User management
- Provider license approval
- Analytics and reporting
- HIPAA audit log viewer
- Broadcast notifications

## 🔧 Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `ENCRYPTION_KEY` | AES-256 encryption key |
| `PORT` | API server port (default: 3001) |
| `NODE_ENV` | Environment (development/production) |

## 📝 Scripts

```bash
npm run dev          # Start development servers
npm run build        # Build for production
npm run start        # Start production servers
npm run migrate      # Run database migrations
npm run migrate:rollback # Rollback last migration
npm run lint         # Run ESLint
```

## 🏥 HIPAA Compliance Checklist

- ✅ Access controls and authentication
- ✅ Audit logging for PHI access
- ✅ Data encryption at rest
- ✅ Secure transmission (SSL/TLS)
- ✅ Session timeout
- ✅ Unique user identification
- ✅ Emergency access procedures
- ✅ Automatic logoff
- ✅ Integrity controls
- ✅ Person/entity authentication

## 📄 License

Proprietary - All rights reserved.

## 🆘 Support

For technical support, please contact the development team.

---

Built with ❤️ by ZumaTeledocAI Team