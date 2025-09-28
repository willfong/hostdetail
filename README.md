# Host Detail

A secure Node.js/Express application that displays host and IP address information with reverse DNS lookup capabilities.

**Live Demo:** https://hostdetail.net

## Features

- Real IP address detection (supports ALB and nginx proxy headers)
- Reverse DNS lookup for IP addresses with **Redis caching** (30-day TTL)
- **IP Geolocation** with detailed location data (country, region, city, ISP, timezone) and **Redis caching** (30-day TTL)
- **Browser detection** with responsive HTML interface for humans, JSON API for automation
- User agent tracking and analytics
- Health check endpoints for monitoring (`/health` and `/alb-health-check`)
- **Structured logging with Pino** for observability (cache hits/misses, 3rd party API calls)
- **Business metrics logging** for monitoring and analytics
- **Country metrics** for geographic request analytics
- **Redis-based performance optimization** for fastest response times
- Secure containerized deployment with Docker Compose

## Development

### Prerequisites

- Node.js 22+
- npm
- Redis (for caching - optional for development)

### Local Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start

# Optional: Start with Redis for caching
docker run -d --name redis -p 6379:6379 redis:7-alpine
REDIS_URL=redis://localhost:6379 npm start
```

### API Endpoints

- `GET /` - Returns client IP, headers, reverse DNS lookup, and geolocation data (HTML for browsers, JSON for APIs)
- `GET /user-agents` - Returns user agent analytics
- `GET /health` - Efficient health check endpoint (200 OK)
- `GET /alb-health-check` - Legacy health check endpoint
- `GET /*` - 404 handler for undefined routes

## Production Deployment

### Docker Compose (Recommended)

The application includes a complete Docker Compose setup with Redis caching for optimal performance:

```bash
# Start the complete stack (hostdetail + Redis)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the stack
docker-compose down
```

### Standalone Docker (without Redis caching)

```bash
# Pull pre-built multi-arch image from Docker Hub
docker pull wfong/hostdetail:latest

# Run with security best practices (same as your original setup)
docker run -d --name hostdetail \
  -p 127.0.0.1:5004:3000 \
  --user 10000:10000 \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  --tmpfs /run:rw,nosuid,nodev,noexec,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt label=type:container_t \
  --pids-limit 200 \
  --ulimit nofile=65536:65536 \
  --ulimit nproc=4096:4096 \
  --memory=128m --memory-swap=128m \
  --cpus=".25" \
  --health-cmd='wget --user-agent="DockerHealthCheck" -qO- http://127.0.0.1:3000/health || exit 1' \
  --health-interval=20s --health-retries=3 --health-timeout=3s \
  --restart unless-stopped \
  wfong/hostdetail:latest
```

#### Building from Source

```bash
# Build for current architecture
docker build -t hostdetail .

# Build for multiple architectures (amd64 and arm64)
docker buildx build --platform linux/amd64,linux/arm64 -t hostdetail .

# Build and push to registry with multi-arch support
docker buildx build --platform linux/amd64,linux/arm64 -t wfong/hostdetail:latest --push .
```

### Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (production/development)
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)
- `SERVICE_VERSION` - Service version for tracking (default: 1.0.0)
- `HOSTNAME` - Host identifier for logs (auto-detected if not set)
- `REDIS_URL` - Redis connection URL (default: redis://localhost:6379)
- `CACHE_TTL_DAYS` - Cache TTL in days for DNS and geolocation (default: 30)

## Monitoring & Observability

### Complete Monitoring Pipeline

This application implements a production-ready monitoring stack: **Pino → Docker Logs → Promtail → Loki → Grafana**

### Structured Logging

The application uses **Pino** for high-performance structured JSON logging, optimized for Docker, Promtail, Loki, and Grafana integration.

#### Log Events

All logs include structured data with these event types:

- **`service_startup`** - Application startup with environment details
- **`user_agent_tracking`** - New/returning user agents with occurrence counts
- **`ip_detection`** - Client IP source detection (proxy headers vs direct connection)
- **`dns_lookup_success`/`dns_lookup_failure`** - Reverse DNS performance and errors
- **`geolocation_lookup_success`/`geolocation_lookup_failure`** - IP geolocation API performance and errors
- **`country_metrics`** - Geographic request distribution by country/region/city
- **`cache_hit`/`cache_miss`/`cache_set`** - Redis cache performance and statistics
- **`cache_parse_error`** - Redis cache data parsing errors
- **`third_party_api_request`/`third_party_api_success`/`third_party_api_error`** - External API call tracking
- **`third_party_api_failure`/`third_party_api_timeout`** - API-specific failures and timeouts
- **`redis_connected`/`redis_connection_error`/`redis_connection_failed`** - Redis connection status
- **`redis_get_error`/`redis_set_error`** - Redis operation errors
- **`ip_detection_failure`** - IP detection failures with debugging context
- **`request_performance`** - Request timing, DNS lookup, and geolocation performance
- **`user_agents_endpoint_accessed`** - Analytics endpoint usage
- **`route_not_found`** - 404 errors with context
- **`server_error`** - 500 errors with full stack traces
- **`periodic_metrics`** - System metrics every 60 seconds

#### Business Metrics Tracked

- **Performance**: Request times, DNS lookup duration, geolocation API response times, cache hit rates
- **Geographic**: Country/region/city distribution, ISP analytics, timezone patterns
- **Caching**: Cache hit/miss ratios, cache performance, Redis connection health
- **Third-party APIs**: External API call success rates, response times, error tracking
- **Security**: IP detection methods, proxy usage patterns
- **Usage**: User agent diversity, endpoint access patterns
- **System Health**: Memory usage, uptime, error rates
- **Availability**: Health check responses

#### Sample Log Structure

```json
{
  "level": "info",
  "time": "2025-01-15T10:30:45.123Z",
  "event": "country_metrics",
  "country": "United States",
  "countryCode": "US",
  "region": "Virginia",
  "city": "Ashburn",
  "clientIp": "8.8.8.8",
  "service": "hostdetail",
  "version": "1.0.0",
  "environment": "production",
  "host": "container-xyz",
  "msg": "Request from United States"
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

# Geolocation API performance
{service="hostdetail"} | json | event="geolocation_lookup_success" | unwrap lookupTimeMs

# Request distribution by country
count by (country) ({service="hostdetail"} | json | event="country_metrics")

# Geographic request heatmap
count by (country, region, city) ({service="hostdetail"} | json | event="country_metrics")

# ISP distribution
count by (isp) ({service="hostdetail"} | json | event="geolocation_lookup_success")

# Cache hit rate
rate({service="hostdetail"} | json | event="cache_hit" [5m]) / rate({service="hostdetail"} | json | event=~"cache_(hit|miss)" [5m])

# Cache performance by type
count by (cacheType) ({service="hostdetail"} | json | event=~"cache_(hit|miss)")

# Third-party API performance
{service="hostdetail"} | json | event="third_party_api_success" | unwrap requestDurationMs

# Redis connection health
{service="hostdetail"} | json | event=~"redis_.*"

# User agent diversity
count by (userAgent) ({service="hostdetail"} | json | event="user_agent_tracking")

# Memory usage trends
{service="hostdetail"} | json | event="periodic_metrics" | unwrap metrics_memory_heapUsed
```

### Setting Up the Complete Monitoring Pipeline

#### 1. Docker Logs Collection
The application outputs structured JSON logs via Pino, which Docker automatically collects:

```bash
# View live logs
docker-compose logs -f hostdetail

# Check log format
docker-compose logs hostdetail | head -5
```

#### 2. Promtail Configuration
Create `promtail-config.yml` to ship logs to Loki:

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: hostdetail
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: 'hostdetail'
        action: keep
      - source_labels: ['__meta_docker_container_name']
        target_label: 'container'
      - source_labels: ['__meta_docker_container_log_stream']
        target_label: 'stream'
    pipeline_stages:
      - json:
          expressions:
            level: level
            time: time
            event: event
            service: service
            environment: environment
            host: host
            country: country
            countryCode: countryCode
            clientIp: clientIp
            responseTimeMs: responseTimeMs
            cacheType: cacheType
            apiProvider: apiProvider
      - labels:
          level:
          event:
          service:
          environment:
          country:
          cacheType:
          apiProvider:
      - timestamp:
          source: time
          format: RFC3339
```

#### 3. Loki Configuration
Create `loki-config.yml`:

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  lifecycler:
    address: 127.0.0.1
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1
    final_sleep: 0s
  chunk_idle_period: 5m
  chunk_retain_period: 30s
  max_transfer_retries: 0

schema_config:
  configs:
    - from: 2021-01-01
      store: boltdb
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 168h

storage_config:
  boltdb:
    directory: /loki/index
  filesystem:
    directory: /loki/chunks

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

chunk_store_config:
  max_look_back_period: 0s

table_manager:
  retention_deletes_enabled: false
  retention_period: 0s
```

#### 4. Complete Docker Compose with Monitoring Stack

Add to your `docker-compose.yml`:

```yaml
  loki:
    image: grafana/loki:2.9.0
    container_name: loki
    restart: unless-stopped
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yaml:ro
      - loki-data:/loki
    networks:
      - hostdetail-network

  promtail:
    image: grafana/promtail:2.9.0
    container_name: promtail
    restart: unless-stopped
    volumes:
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./promtail-config.yml:/etc/promtail/config.yml:ro
    command: -config.file=/etc/promtail/config.yml
    depends_on:
      - loki
    networks:
      - hostdetail-network

  grafana:
    image: grafana/grafana:10.1.0
    container_name: grafana
    restart: unless-stopped
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=your_secure_password
    volumes:
      - grafana-data:/var/lib/grafana
    ports:
      - "3001:3000"
    depends_on:
      - loki
    networks:
      - hostdetail-network

volumes:
  loki-data:
  grafana-data:
```

#### 5. Grafana Dashboard Setup

1. **Add Loki Data Source**: Navigate to Data Sources → Add data source → Loki
   - URL: `http://loki:3100`
   - Access: Server (default)

2. **Import Dashboard**: Use the JSON configuration below or create panels with these queries

#### 6. Essential Grafana Panels

**Request Rate Panel**:
```logql
rate({service="hostdetail"} | json | __error__="" | event="request_performance" [5m])
```

**Error Rate Panel**:
```logql
rate({service="hostdetail"} | json | level="error" [5m]) / rate({service="hostdetail"} | json [5m])
```

**Response Time Percentiles**:
```logql
quantile_over_time(0.95, {service="hostdetail"} | json | event="request_performance" | unwrap responseTimeMs [5m])
```

**Geographic Request Distribution**:
```logql
count by (country) ({service="hostdetail"} | json | event="country_metrics" | country != "")
```

**Cache Hit Rate**:
```logql
rate({service="hostdetail"} | json | event="cache_hit" [5m]) / rate({service="hostdetail"} | json | event=~"cache_(hit|miss)" [5m]) * 100
```

**External API Performance**:
```logql
{service="hostdetail"} | json | event="third_party_api_success" | unwrap requestDurationMs
```

**DNS Lookup Performance**:
```logql
{service="hostdetail"} | json | event="dns_lookup_success" | unwrap lookupTimeMs
```

### Health Monitoring

The application includes comprehensive health monitoring:
- **Docker health check** via `/alb-health-check` endpoint
- **HTTP request logging** with response times and status codes
- **Periodic system metrics** for memory, uptime, and business KPIs
- **Error tracking** with full context and stack traces
- **Performance monitoring** for DNS lookups, geolocation API calls, and request processing
- **Geographic analytics** with country/region/city distribution tracking
- **3rd party API monitoring** with timeout handling (2s) and failure logging

### Alerting Rules (Optional)

Create alerts in Grafana for:

**High Error Rate**:
```logql
rate({service="hostdetail"} | json | level="error" [5m]) > 0.1
```

**High Response Time**:
```logql
quantile_over_time(0.95, {service="hostdetail"} | json | event="request_performance" | unwrap responseTimeMs [5m]) > 1000
```

**Cache Miss Rate Too High**:
```logql
rate({service="hostdetail"} | json | event="cache_miss" [5m]) / rate({service="hostdetail"} | json | event=~"cache_(hit|miss)" [5m]) > 0.5
```

**External API Failures**:
```logql
rate({service="hostdetail"} | json | event=~"third_party_api_(error|timeout|failure)" [5m]) > 0.1
```

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
