# Host Detail

A secure Node.js/Express application that displays host and IP address information with reverse DNS lookup capabilities.

**Live Demo:** https://hostdetail.net

## Features

- Real IP address detection (supports ALB and nginx proxy headers)
- Reverse DNS lookup for IP addresses
- User agent tracking and analytics
- Health check endpoints for monitoring
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

### Health Monitoring

The application includes built-in health checks:
- Docker health check via `/alb-health-check` endpoint
- Application logging via morgan middleware

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
