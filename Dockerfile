# 1. Install dependencies only when needed
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Rebuild the source code only when needed
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# This builds the app (Next.js/React)
RUN npm run build

# 3. Production image, copy all the files and run next
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

# Create a non-root user for security (HIPAA Best Practice)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy the build output
COPY --from=builder /app/public ./public
# Note: If you are NOT using Next.js, you might need to adjust the line below to point to your build folder
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Copy the server folder for API routes
COPY --from=builder /app/server ./server
# Copy lib folder for shared utilities
COPY --from=builder /app/lib ./lib

USER nextjs

EXPOSE 8080
ENV PORT 8080
# Increase Node.js max HTTP header size to handle large auth tokens
ENV NODE_OPTIONS="--max-http-header-size=32768"

CMD ["npm", "start"]
