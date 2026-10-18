# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ---- Production stage ----
FROM node:20-alpine AS production

# Create a non-root runtime user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install init process for signal handling
RUN apk --no-cache add dumb-init=1.2.5-r3

WORKDIR /app

# Copy runtime files with ownership set during copying
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup src/ ./src/

USER appuser

EXPOSE 5000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
