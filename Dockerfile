# Use specific Node.js version with alpine for security and smaller size
FROM node:20-alpine

# Install security updates and required packages
RUN apk update && apk upgrade && apk add --no-cache \
    wget \
    tini && \
    rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -S appuser -u 1001 -G appuser

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with npm ci for production
RUN npm ci --only=production && npm cache clean --force

# Copy application code and set ownership
COPY --chown=appuser:appuser . .

# Create temp directory for application with proper permissions
RUN mkdir -p /tmp/app && chown -R appuser:appuser /tmp/app

# Switch to non-root user
USER appuser

# Set NODE_ENV to production
ENV NODE_ENV=production
ENV TMPDIR=/tmp/app

# Expose port
EXPOSE 3000

# Health check using existing endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/alb-health-check || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["npm", "start"]
