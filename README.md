# Host Detail

A secure Node.js/Express application that displays host and IP address information with reverse DNS lookup capabilities.

**Live Demo:** https://hostdetail.net

## Features

- Real IP address detection (supports ALB and nginx proxy headers)
- Reverse DNS lookup for IP addresses
- User agent tracking and analytics
- Health check endpoints for monitoring
- **Structured logging with Pino** for observability
- **Business metrics logging** for monitoring and analytics
- Secure containerized deployment

## Development

### Prerequisites

- Node.js 20+
- npm

### Local Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

### API Endpoints

- `GET /` - Returns client IP, headers, and reverse DNS lookup
- `GET /user-agents` - Returns user agent analytics
- `GET /alb-health-check` - Health check endpoint
- `GET /*` - 404 handler for undefined routes

## Production Deployment

### Docker (Recommended)

The application is designed to run in a secure, read-only container with multi-architecture support:

```bash
# Pull pre-built ARM64 image from Docker Hub
docker pull wfong/b1n:latest

# Run with security best practices
docker run \
  --restart=unless-stopped \
  --read-only \
  --tmpfs /tmp \
  --user 1001:1001 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  -p 3000:3000 \
  -d \
  --name hostdetail \
  wfong/b1n:latest
```

#### Building from Source

```bash
# Build for current architecture
docker build -t hostdetail .

# Build for ARM64 (multi-architecture)
docker buildx build --platform linux/arm64 -t hostdetail:arm64 .

# Build and push to registry
docker buildx build --platform linux/arm64 -t your-registry/image:latest --push .
```

### Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (production/development)
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)
- `SERVICE_VERSION` - Service version for tracking (default: 1.0.0)
- `HOSTNAME` - Host identifier for logs (auto-detected if not set)

## Monitoring & Observability

### Structured Logging

The application uses **Pino** for high-performance structured JSON logging, optimized for Docker, Promtail, Loki, and Grafana integration.

#### Log Events

All logs include structured data with these event types:

- **`service_startup`** - Application startup with environment details
- **`user_agent_tracking`** - New/returning user agents with occurrence counts
- **`ip_detection`** - Client IP source detection (proxy headers vs direct connection)
- **`dns_lookup_success`/`dns_lookup_failure`** - Reverse DNS performance and errors
- **`request_performance`** - Request timing and DNS lookup performance
- **`user_agents_endpoint_accessed`** - Analytics endpoint usage
- **`route_not_found`** - 404 errors with context
- **`server_error`** - 500 errors with full stack traces
- **`periodic_metrics`** - System metrics every 60 seconds

#### Business Metrics Tracked

- **Performance**: Request times, DNS lookup duration
- **Security**: IP detection methods, proxy usage patterns
- **Usage**: User agent diversity, endpoint access patterns
- **System Health**: Memory usage, uptime, error rates
- **Availability**: Health check responses

#### Sample Log Structure

```json
{
  "level": "info",
  "time": "2025-01-15T10:30:45.123Z",
  "event": "user_agent_tracking",
  "userAgent": "Mozilla/5.0...",
  "isNewUserAgent": true,
  "totalOccurrences": 1,
  "totalUniqueUserAgents": 42,
  "service": "hostdetail",
  "version": "1.0.0",
  "environment": "production",
  "host": "container-xyz",
  "msg": "User agent tracked"
}
```

### Grafana Dashboard Queries

Example LogQL queries for Grafana dashboards:

```logql
# Request rate by endpoint
rate({service="hostdetail"} | json | __error__="" | event="request_performance" [5m])

# Error rate
rate({service="hostdetail"} | json | level="error" [5m])

# DNS lookup performance
{service="hostdetail"} | json | event="dns_lookup_success" | unwrap dnsLookupTimeMs

# User agent diversity
count by (userAgent) ({service="hostdetail"} | json | event="user_agent_tracking")

# Memory usage trends
{service="hostdetail"} | json | event="periodic_metrics" | unwrap metrics_memory_heapUsed
```

### Health Monitoring

The application includes comprehensive health monitoring:
- **Docker health check** via `/alb-health-check` endpoint
- **HTTP request logging** with response times and status codes
- **Periodic system metrics** for memory, uptime, and business KPIs
- **Error tracking** with full context and stack traces
- **Performance monitoring** for DNS lookups and request processing

## AWS ECS Deployment

```bash
# Deploy to ECS cluster
npm run deploy

# View logs
npm run logs

# Deploy toolist service
npm run aws:deploy-toolist
```

## Security Features

- **Multi-stage build** - Optimized build process with reduced attack surface
- **Read-only filesystem** - Container runs with read-only root filesystem
- **Non-root user** - Application runs as unprivileged user (UID 1001)
- **Minimal attack surface** - Alpine-based image with only required packages
- **Memory optimization** - Node.js heap limited to 128MB for efficient resource usage
- **Signal handling** - Proper process management with dumb-init system
- **Input validation** - Handles malformed headers gracefully
- **Error handling** - Comprehensive error handling and logging
- **ARM64 support** - Optimized for modern ARM-based infrastructure

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and security checks
5. Submit a pull request

## License

MIT
