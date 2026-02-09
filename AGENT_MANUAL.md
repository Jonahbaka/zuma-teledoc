# PROJECT GENESIS — Agent Society Manual
### DoctaRx Sovereign AI Agent Orchestrator
### For The Operator

---

## TABLE OF CONTENTS
1. [What Is This?](#1-what-is-this)
2. [The 12 Agents — Who They Are](#2-the-12-agents)
3. [How To Access](#3-how-to-access)
4. [How To Talk To Agents](#4-how-to-talk-to-agents)
5. [The Credential Vault](#5-the-credential-vault)
6. [Results Tracking](#6-results-tracking)
7. [What Agents Can Do RIGHT NOW](#7-what-agents-can-do-right-now)
8. [What Agents Can Do WHEN DEPLOYED](#8-what-agents-can-do-when-deployed)
9. [The AI Ops Portal](#9-the-ai-ops-portal)
10. [Safety & Controls](#10-safety--controls)
11. [Architecture Overview](#11-architecture-overview)
12. [Deployment Checklist](#12-deployment-checklist)

---

## 1. WHAT IS THIS?

Project Genesis is a society of 12 AI agents that work for DoctaRx. Each agent has:

- **A real brain** — Powered by Google Gemini 2.0 Flash (can reason, research, plan)
- **A persona** — Each agent has a unique identity, specialty, and communication style
- **A memory** — Conversation history is stored in the database
- **A governance system** — Proposals are scored with 3-6-9 Vortex Logic
- **Safety rails** — Compliance agent can veto any action; Operator approval required for all financial/external actions

**Think of it as:** 12 specialized employees that never sleep, never forget, and can reason about complex problems in seconds.

---

## 2. THE 12 AGENTS

### The Original Six (Core Operations)

| # | Code Name | Role | What They Do |
|---|-----------|------|--------------|
| 1 | **The Weaver** | Operations | Optimizes scheduling, patient flow, provider throughput. Finds operational bottlenecks. |
| 2 | **The Scout** | Growth & Marketing | Finds growth opportunities, cheap ad channels, competitor weaknesses. Manages social media. |
| 3 | **The Builder** | Corporate Skills | Handles EIN registration, bank accounts, vendor compliance, business licensing. |
| 4 | **The Alchemist** | Revenue & Finance | Pricing analysis, LTV modeling, profitability simulation, financial reporting. |
| 5 | **The Guardian** | Compliance & Safety | HIPAA enforcement, legal auditing, ethical veto power. Can override any agent. |
| 6 | **The Sage** | Governance | Scores every proposal with 3-6-9 Vortex Logic. Approves/rejects agent actions. |

### The Expanded Council (Specialized Intelligence)

| # | Code Name | Role | What They Do |
|---|-----------|------|--------------|
| 7 | **The Oracle** | Research | Deep market/competitor/technology research. Every claim has a source & confidence level. |
| 8 | **The Economist** | Economics | Game theory, price elasticity, incentive design, behavioral economics. |
| 9 | **The Architect** | Physics | Applies thermodynamics, flow dynamics, network theory, chaos theory to the business. |
| 10 | **The Calculator** | Mathematics | Bayesian inference, Monte Carlo simulations, queueing theory, statistical testing. |
| 11 | **The Tesseract** | Vortex Mathematics | Sacred geometry, 3-6-9 patterns, Fibonacci scaling, toroidal flow mapping. |
| 12 | **The Conductor** | CEO / Executive | Synthesizes ALL agent intelligence into one brief for The Operator. Your single point of truth. |

---

## 3. HOW TO ACCESS

### Local Development
1. Start the server: `npm run dev`
2. Go to: `http://localhost:8080/secure/admin`
3. Log in with admin credentials
4. Navigate to **AI & Intelligence** in the sidebar
5. Choose:
   - **Agent Command Center** — Chat with agents, manage credentials, track results
   - **AI Operations Portal** — System monitoring, proposals, governance
   - **Predictive Intelligence** — ML models and data analytics

### After Deployment (Cloud)
- Same paths, just replace `localhost:8080` with your production domain
- Example: `https://app.doctarx.com/secure/admin` → AI & Intelligence → Agent Command Center

---

## 4. HOW TO TALK TO AGENTS

### Direct Message (1-on-1)
1. Open **Agent Command Center**
2. Click any agent in the left sidebar (e.g., "The Scout")
3. Type your message and press Enter or click Send
4. The agent responds using **Gemini AI** — real reasoning, not canned responses

### Broadcast (All Agents)
1. Click **"All Agents"** in the sidebar
2. Type your message — it goes to ALL 12 agents
3. Each agent responds from their unique perspective

### Summon the Council
1. Click the **"Summon Council"** button (gold button in header)
2. All 12 agents introduce themselves in order
3. Each introduction is AI-generated and unique every time

### What To Ask Them

| Ask This | Who Responds Best |
|----------|------------------|
| "What's our competitive advantage?" | The Scout, The Oracle |
| "How should we price our services?" | The Alchemist, The Economist |
| "Is this HIPAA compliant?" | The Guardian |
| "What should I focus on this week?" | The Conductor (CEO) |
| "Run a Monte Carlo on our revenue forecast" | The Calculator |
| "Where are competitors slow?" | The Scout (Matrix Protocol) |
| "Should we hire more providers?" | The Weaver, The Calculator |
| "What's the optimal pricing?" | The Economist, The Tesseract |
| "Research telehealth market size" | The Oracle |
| "Give me an executive summary" | The Conductor |
| "How do I register an EIN?" | The Builder |
| "Where is energy being wasted?" | The Architect |

### Tips
- Be specific: "Analyze our appointment booking flow for bottlenecks" > "How are things going?"
- Agents remember conversation context within a session
- You can ask follow-up questions — they maintain the thread
- Every response is powered by Gemini 2.0 Flash AI (shown with a blue "Gemini" badge)

---

## 5. THE CREDENTIAL VAULT

### What It Is
A secure, encrypted storage for platform login credentials (social media, ad platforms, payment gateways, etc.) that agents need to interact with the world.

### How To Add Credentials
1. Go to **Agent Command Center** → **Credentials Vault** tab
2. Click **"Add New Credential"**
3. Fill in:
   - **Platform** — Select from dropdown (Twitter, LinkedIn, Instagram, Google Ads, etc.)
   - **Account Label** — A name for this credential (e.g., "DoctaRx Main Twitter")
   - **Username** — The login username/email
   - **Password** — The login password
   - **API Key / Secret** — If the platform uses API keys
   - **Assigned Agents** — Which agents can access this credential
   - **Notes** — Any additional info
4. Click **Save** — Credential is encrypted with AES-256-GCM

### Security
- All credentials encrypted at rest (AES-256-GCM)
- Only assigned agents can decrypt
- Every access is logged in the audit trail
- Credentials are NEVER exposed in the UI after saving (only metadata shown)

### Supported Platforms
Twitter/X, LinkedIn, Instagram, Facebook, TikTok, Google Ads, Meta Ads, YouTube, GitHub, Stripe, Square, PayPal, QuickBooks, Zoho, Mailchimp, SendGrid, Twilio, AWS, Google Cloud, Azure, Slack, Discord, Zoom, Custom API

---

## 6. RESULTS TRACKING

### What It Is
A dashboard showing tangible, measurable outcomes from agent operations. No black box.

### What Gets Tracked
- **Result Type** — What kind of outcome (revenue, efficiency, research, etc.)
- **Title** — Short description
- **Metrics** — Quantified numbers (clicks, conversions, dollars, time saved)
- **Evidence** — Screenshots, API data, analytics links
- **Timestamp** — When it happened

### How To View
- Go to **Agent Command Center** → **Results** tab
- See summary cards (total results, by agent, by type)
- Browse the full list with metrics and evidence

---

## 7. WHAT AGENTS CAN DO RIGHT NOW (Local)

### Immediately Available
| Capability | Description |
|-----------|-------------|
| **Reason about anything** | Ask any question — they use Gemini AI to think and respond intelligently |
| **Research** | The Oracle can research markets, competitors, regulations, technology |
| **Analyze** | The Economist, Calculator, Architect can analyze data with real frameworks |
| **Strategize** | The Conductor synthesizes all intelligence into executive briefs |
| **Store credentials** | Securely store platform logins for future agent use |
| **Propose actions** | Agents generate proposals that go through governance review |
| **Compliance checking** | The Guardian checks everything against HIPAA and legal requirements |

### What They CANNOT Do Yet (Requires Additional Integration)
| Capability | What's Needed |
|-----------|--------------|
| Post to social media | Social media API integration (Twitter API, LinkedIn API, etc.) |
| Run ad campaigns | Google Ads API / Meta Ads API credentials + integration code |
| Send emails on their own | Already have SMTP — needs agent-triggered email capability |
| Process payments | Stripe is integrated but agent-initiated payments need Operator approval flow |
| Create accounts on platforms | Requires platform-specific automation (Puppeteer/Playwright) |
| Real-time market data | Requires data feed APIs (Bloomberg, Alpha Vantage, etc.) |

---

## 8. WHAT AGENTS CAN DO WHEN DEPLOYED (Cloud)

When deployed to Google Cloud (or any cloud provider), agents gain **persistent uptime** and **internet access**. Here's what changes:

### Always-On Intelligence
- Agents run 24/7 — not just when your laptop is open
- Scheduled runs (e.g., The Scout scans for opportunities every 6 hours)
- The Conductor sends daily morning briefs to your email
- Real-time alerts when The Guardian detects a compliance issue

### Internet Access (With Credentials)
Once you provide platform credentials via the Vault, agents can:

| Agent | Cloud Capability |
|-------|-----------------|
| **The Scout** | Post to Twitter/LinkedIn/Instagram, monitor engagement, run A/B tests on ad copy, track competitor social media, identify trending keywords |
| **The Builder** | Research state-specific business requirements, track regulatory filings, monitor corporate compliance deadlines |
| **The Alchemist** | Pull Stripe revenue data in real-time, generate financial reports, monitor subscription churn |
| **The Oracle** | Continuously scan industry news, competitor announcements, regulatory changes, academic papers |
| **The Guardian** | Monitor for data breaches, scan for HIPAA violations, track compliance deadlines |
| **The Conductor** | Compile daily/weekly executive briefs, email them to you, escalate urgent items |

### The OpenClaw Framework (Skill Acquisition)
When deployed, agents proactively learn new skills:

1. **Ingest** — Agent reads documentation/API specs for a new capability
2. **Simulate** — Agent runs a dry-run in sandbox mode
3. **Register** — Skill is saved to the Verified Skill Registry
4. **Execute** — Skill is available for future use (with governance approval)

Example: The Builder needs to file a Delaware Franchise Tax. It:
1. Reads the Delaware Division of Corporations website
2. Fills out the form in a sandbox
3. Presents the completed form to you for review
4. After your approval, submits it

### Autonomy Levels (You Control)
| Level | Description | Example |
|-------|-------------|---------|
| 0 — Observe Only | Agent watches and reports. Takes no action. | Default for all agents |
| 1 — Suggest | Agent proposes actions, you approve each one. | "I'd like to post this tweet" |
| 2 — Low Autonomy | Agent can do read-only tasks freely (research, analysis). | Pulling Stripe data |
| 3 — Medium Autonomy | Agent can do low-risk actions (post social media). | Posting pre-approved content |
| 4 — High Autonomy | Agent can do most tasks, asks only for financial/legal. | Running ad campaigns |
| 5 — Full Autonomy | Agent acts independently. **Not recommended.** | Emergency only |

**You set each agent's level individually** from the AI Ops Portal.

### Matrix Protocol (Cloud-Powered)
With internet access, the Matrix Protocol becomes real:

- **Glitch Detection**: The Scout monitors competitor websites for slow processes, high prices, poor UX — and flags opportunities in real-time
- **Arbitrage Hunting**: The Alchemist monitors pricing across markets, the Economist tracks labor arbitrage opportunities
- **Reality Hacking**: The Builder identifies bureaucratic processes that can be automated

---

## 9. THE AI OPS PORTAL

### What It Is
The system monitoring dashboard for the entire agent society.

### How To Access
- Admin sidebar → **AI & Intelligence** → **AI Operations Portal**
- URL: `/admin/agent-ops`

### What You See
| Tab | What It Shows |
|-----|--------------|
| **Dashboard** | All 12 agents' status, uptime, operating mode |
| **Proposals** | Agent proposals awaiting your approval/rejection |
| **Intents** | Pending agent actions requiring authorization |
| **Skills** | Registered skills (OpenClaw Framework) |
| **Briefings** | Daily briefings from each agent |
| **Audit Log** | Complete trail of every agent action |
| **Matrix Protocol** | Glitch detection, arbitrage findings, reality hack classifier |

---

## 10. SAFETY & CONTROLS

### The Human-in-the-Loop Lock
- **NEVER** will an agent execute a financial transaction, sign a contract, or submit a legal filing without your explicit approval
- The flow is always: **Prepare → Simulate → Request Operator Authorization → Execute**

### The Guardian's Veto Power
- The Guardian (Compliance Agent) can **veto any action by any agent** — including The Conductor
- Automatic veto triggers: PHI exposure, HIPAA violation, unauthorized financial action

### Emergency Shutdown
- One-click **Emergency Shutdown** button in the AI Ops Portal
- Immediately halts ALL agents
- Requires manual resume

### Audit Trail
- Every agent action is logged with timestamp, agent ID, action type, and details
- Immutable audit trail in the database
- Accessible from AI Ops Portal → Audit Log tab

### Data Protection
- All credentials: AES-256-GCM encrypted
- All messages: Stored in PostgreSQL with access controls
- HIPAA-compliant: PHI is never exposed to agent reasoning without redaction
- The Guardian monitors all data flows

---

## 11. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────┐
│                   THE OPERATOR (You)                 │
│              Agent Command Center UI                 │
└────────────────────────┬────────────────────────────┘
                         │
                    Chat / Commands
                         │
┌────────────────────────▼────────────────────────────┐
│              GEMINI 2.0 FLASH (AI Brain)             │
│         Reasoning · Research · Analysis              │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              AGENT ORCHESTRATOR (index.js)            │
│     Initializes agents · Manages run cycles          │
│     Injects shared systems · Controls autonomy       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Weaver  │ │  Scout  │ │ Builder │ │Alchemist│  │
│  │  (Ops)  │ │(Growth) │ │ (Corp)  │ │  (Rev)  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
│       │           │           │           │        │
│  ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐  │
│  │Guardian │ │  Sage   │ │ Oracle  │ │Economist│  │
│  │(Comply) │ │ (Gov)   │ │(Resrch) │ │ (Econ)  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
│       │           │           │           │        │
│  ┌────┴────┐ ┌────┴────┐ ┌────┴────┐              │
│  │Architect│ │Calcultr │ │Tesseract│ ┌─────────┐  │
│  │(Physics)│ │ (Math)  │ │(Vortex) │ │Conductor│  │
│  └─────────┘ └─────────┘ └─────────┘ │  (CEO)  │  │
│                                       └─────────┘  │
├─────────────────────────────────────────────────────┤
│              SHARED SYSTEMS                          │
│  Intent System → Compliance Engine → Governance      │
│  Skill Registry → Capability Adapters                │
│  Credential Vault (AES-256-GCM)                     │
│  Audit Log · Briefings · Results Tracking            │
└─────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              DATABASE (PostgreSQL / Aiven)            │
│  ai_agents · ai_chat_messages · ai_credential_vault  │
│  ai_agent_results · ai_proposals · ai_audit_log      │
│  ai_briefings · ai_skills · ai_intents              │
└─────────────────────────────────────────────────────┘
```

### Data Flow for a Chat Message
1. You type a message in the Agent Command Center
2. Message is sent to `POST /api/agent-chat/messages`
3. Your message is stored in `ai_chat_messages`
4. The agent's persona + conversation history is sent to **Gemini 2.0 Flash**
5. Gemini generates a reasoned response in-character
6. Response is stored in `ai_chat_messages`
7. Both messages appear in the UI

### Data Flow for an Agent Run Cycle
1. Admin triggers "Run All Agents" from AI Ops Portal
2. Each agent runs: **Observe → Analyze → Propose**
3. Each step can use Gemini for AI reasoning
4. Proposals go through: **Compliance Check → 3-6-9 Scoring → Governance Review**
5. Approved proposals await Operator authorization
6. Results are logged and displayed in dashboards

---

## 12. DEPLOYMENT CHECKLIST

When you're ready to deploy to Google Cloud:

### Environment Variables (Required)
```
GEMINI_API_KEY=AIzaSy...          # Your Gemini API key (billing enabled)
DATABASE_URL=postgres://...        # Your PostgreSQL connection
JWT_ACCESS_SECRET=...              # JWT signing secret
JWT_REFRESH_SECRET=...             # JWT refresh secret
ENCRYPTION_KEY=...                 # 32-byte AES key for credential vault
SESSION_SECRET=...                 # Session encryption
STRIPE_SECRET_KEY=sk_live_...      # Stripe (if using payments)
SMTP_HOST=smtp.zoho.com            # Email
SMTP_USER=info@doctarx.com
SMTP_PASSWORD=...
```

### Pre-Deploy Steps
- [ ] Run database migrations (300, 400, 500 series)
- [ ] Verify Gemini API key has billing enabled
- [ ] Set `NODE_ENV=production`
- [ ] Update CORS origins in `server/index.js` for your production domain
- [ ] Update `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_URL`
- [ ] Test admin login and Agent Command Center locally

### Post-Deploy Verification
- [ ] Access admin portal at `https://yourdomain.com/secure/admin`
- [ ] Navigate to Agent Command Center
- [ ] Send a test message to any agent — confirm Gemini-powered response
- [ ] Check AI Ops Portal — all 12 agents should show "idle" status
- [ ] Test Summon Council — all 12 should introduce themselves
- [ ] Add one test credential to the vault — confirm it encrypts
- [ ] Review Audit Log — confirm actions are being logged

### Recommended Post-Deploy Setup
1. **Set autonomy levels** for each agent (start at 0 — Observe Only)
2. **Add platform credentials** for agents that need web access
3. **Run a full agent cycle** from AI Ops Portal to generate initial briefings
4. **Review proposals** and approve/reject from the Proposals tab
5. **Gradually increase autonomy** as you build trust with each agent

---

## QUICK REFERENCE CARD

| Action | How |
|--------|-----|
| Talk to one agent | Agent Command Center → Click agent → Type message |
| Talk to all agents | Agent Command Center → Click "All Agents" → Type message |
| Summon introductions | Click "Summon Council" button |
| Add platform credential | Credentials Vault tab → Add New Credential |
| View results | Results tab → Browse outcomes |
| Monitor agents | AI Ops Portal → Dashboard |
| Review proposals | AI Ops Portal → Proposals tab |
| Emergency stop | AI Ops Portal → Emergency Shutdown button |
| View audit trail | AI Ops Portal → Audit Log tab |
| Change agent autonomy | AI Ops Portal → Agent card → Set autonomy level |

---

## COST ESTIMATE (Gemini API)

| Usage Level | Monthly Cost |
|-------------|-------------|
| Light (50 chats/day) | ~$0.50 - $2.00 |
| Medium (200 chats/day) | ~$2.00 - $8.00 |
| Heavy (1000 chats/day + agent runs) | ~$10.00 - $30.00 |
| Enterprise (continuous agent cycles) | ~$30.00 - $100.00 |

Gemini 2.0 Flash pricing: $0.10/M input tokens, $0.40/M output tokens.
A typical agent response uses ~500-1500 tokens total = fractions of a cent.

---

---

## 13. GENESIS v3 UPGRADE — WHAT'S NEW

### Dual Model Routing (Paid Tier 1 — Latest Models)
| Task | Model | Speed |
|------|-------|-------|
| Chat, intros, status | **Gemini 3 Flash** | ~1.2s |
| Research, code analysis, proposals | **Gemini 3 Pro** | ~10-13s |
| Matrix Protocol (glitches/arbitrages) | **Gemini 3 Pro** | ~10-13s |
| Heartbeat analysis | **Gemini 3 Flash** | ~1.2s |

### The Debugger (Agent #13)
- **Monitors all server errors** in real-time
- **Analyzes code** with Gemini Pro and proposes exact fixes
- **Self-heals** safe issues (syntax errors, missing imports)
- **Notifies Operator** immediately for critical issues via chat
- Captures uncaught exceptions and unhandled rejections

### Heartbeat System (Proactive)
- **Error monitor**: every 60 seconds
- **Health check**: every 5 minutes (memory, DB, agent status)
- **Agent cycle**: every 6 hours (all 13 agents run their full observe→analyze→propose cycle)
- **Operator notifications**: automatic alerts for spikes, DB issues, memory warnings

### Persistent Memory (Second Brain)
- Agents remember things across sessions and server restarts
- Auto-extracts facts, goals, and preferences from conversations
- Shared memory accessible by all agents
- Memory types: facts, context, preferences, learnings

### Security Verification
- All write actions require Operator approval
- The Guardian can veto any agent (including CEO)
- The Debugger never modifies auth/encryption code without review
- Credential vault: AES-256-GCM encrypted, audited access

### Deployment
- Docker container optimized for Cloud Run
- Health check endpoint: `/api/health`
- Cloud Build auto-deploys on push
- Secrets managed via Google Secret Manager
- Min 1 instance (always-on for heartbeats)

---

*Project Genesis v3 — Syntropy Over Entropy*
*13 Agents. Dual-Model AI. Proactive Heartbeats. Self-Healing.*
*The Operator Commands. The Agents Execute.*
