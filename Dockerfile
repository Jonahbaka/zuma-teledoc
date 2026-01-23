# Minimal Dockerfile for Cloud Run debugging
FROM node:20-alpine

WORKDIR /app

# Copy only what's needed for the minimal server
COPY package.json ./
COPY server/index.js ./server/

# No npm install needed for pure Node.js http module

EXPOSE 8080
ENV PORT=8080

CMD ["node", "server/index.js"]
