# Kurisu Dockerfile
# Production build using tsx runtime (no compilation needed)

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src
COPY config ./config

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S kurisu && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G kurisu -g kurisu kurisu

WORKDIR /app

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Copy files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY config ./config

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create directory for logs
RUN mkdir -p /app/logs && chown -R kurisu:kurisu /app

# Switch to non-root user
USER kurisu

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Entry point
ENTRYPOINT ["/sbin/tini", "--"]

# Default command: HTTP server (using tsx runtime)
CMD ["npx", "tsx", "src/bin/server.ts"]
