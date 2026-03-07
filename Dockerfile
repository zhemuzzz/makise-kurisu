# Kurisu Dockerfile
# Production build using tsx runtime (no compilation needed)

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies + pnpm
RUN apk add --no-cache python3 make g++ && \
    corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src
COPY config ./config

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

# Security: Create non-root user with docker group access (for sibling containers)
RUN addgroup -g 1001 -S kurisu && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G kurisu -g kurisu kurisu && \
    addgroup -g 999 -S docker 2>/dev/null || true && \
    addgroup kurisu docker 2>/dev/null || true

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

# Create directory for logs and sandbox workspace
RUN mkdir -p /app/logs /tmp/kurisu-workspace && chown -R kurisu:kurisu /app /tmp/kurisu-workspace

# Switch to non-root user
USER kurisu

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Entry point
ENTRYPOINT ["/sbin/tini", "--"]

# Default command: main entry point (using tsx runtime)
CMD ["npx", "tsx", "src/main.ts"]
