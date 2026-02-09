# ═══════════════════════════════════════════════════════════════
#  DoctaRx — AI-First Telehealth Platform
#  PROJECT GENESIS: Sovereign Agent Society
#  Docker Production Build
# ═══════════════════════════════════════════════════════════════

# 1. Install dependencies only when needed
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# 2. Build the source code
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build Next.js
RUN npm run build

# 3. Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user (HIPAA Best Practice)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy server (Express API + Agent Orchestrator)
COPY --from=builder /app/server ./server

# Copy shared libraries
COPY --from=builder /app/lib ./lib

# Copy config files
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/postcss.config.js ./postcss.config.js
COPY --from=builder /app/tailwind.config.js ./tailwind.config.js
COPY --from=builder /app/jsconfig.json ./jsconfig.json

# Copy components (needed for Next.js SSR)
COPY --from=builder /app/components ./components
COPY --from=builder /app/app ./app

USER nextjs

EXPOSE 8080
ENV PORT=8080
# Increase Node.js memory for agent orchestrator + Gemini calls
ENV NODE_OPTIONS="--max-http-header-size=32768 --max-old-space-size=2048"

# Health check for Cloud Run / Docker Compose
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

CMD ["npm", "start"]
