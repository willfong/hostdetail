# Multi-stage build for optimal size and security
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Remove dev dependencies and clean up
RUN npm prune --omit=dev && \
    npm cache clean --force

# Production stage
FROM node:22-alpine AS production

# Install runtime dependencies and security updates
RUN apk update && apk upgrade && apk add --no-cache \
    dumb-init \
    curl && \
    rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

# Create non-root user with specific UID/GID
RUN addgroup -g 1001 -S appuser && \
    adduser -S appuser -u 1001 -G appuser

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force && \
    rm -rf ~/.npm /tmp/*

# Copy application code from builder stage
COPY --from=builder --chown=appuser:appuser /app .

# Create necessary directories with proper permissions
RUN mkdir -p /tmp/app && \
    chown -R appuser:appuser /tmp/app && \
    chmod 755 /tmp/app

# Remove unnecessary files to reduce image size
RUN rm -rf .git .gitignore .dockerignore .vscode .idea *.md

# Switch to non-root user
USER appuser

# Set environment variables for production and memory optimization
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=128" \
    NPM_CONFIG_LOGLEVEL=warn \
    TMPDIR=/tmp/app

# Expose port
EXPOSE 3000

# Health check with curl instead of wget for better error handling
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/alb-health-check || exit 1

# Use dumb-init for proper signal handling and process management
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start application with exec form for proper signal handling
CMD ["node", "index.js"]
