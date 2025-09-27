const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");

const app = express();
const port = process.env.PORT || 3000;

const dns = require("dns");

let user_agents = {};

const logger = pino({
	level: process.env.LOG_LEVEL || 'info',

	// Optimize for Docker/Loki ingestion
	formatters: {
		level: (label) => {
			return { level: label };
		},
		log: (object) => {
			// Add service metadata for Loki labels
			return {
				...object,
				service: 'hostdetail',
				version: process.env.SERVICE_VERSION || '1.0.0',
				environment: process.env.NODE_ENV || 'production',
				host: process.env.HOSTNAME || 'unknown'
			};
		}
	},

	// Use ISO timestamp for better Grafana compatibility
	timestamp: pino.stdTimeFunctions.isoTime,

	// Redact sensitive information
	redact: [
		'req.headers.authorization',
		'req.headers.cookie',
		'request.headers.authorization',
		'request.headers.cookie'
	],

	// Add base fields that are useful for monitoring
	base: {
		pid: process.pid,
		hostname: process.env.HOSTNAME || require('os').hostname()
	},

	// Ensure output is line-delimited JSON for Promtail
	serializers: {
		err: pino.stdSerializers.err,
		req: pino.stdSerializers.req,
		res: pino.stdSerializers.res
	}
});

const httpLogger = pinoHttp({
	logger,
	customLogLevel: function (req, res, err) {
		if (res.statusCode >= 400 && res.statusCode < 500) {
			return 'warn';
		} else if (res.statusCode >= 500 || err) {
			return 'error';
		} else if (res.statusCode >= 300 && res.statusCode < 400) {
			return 'silent';
		}
		return 'info';
	},
	customSuccessMessage: function (req, res) {
		if (req.url === '/alb-health-check') {
			return 'health check';
		}
		return `${req.method} ${req.url}`;
	},
	customErrorMessage: function (req, res, err) {
		return `${req.method} ${req.url} - ${err.message}`;
	},
	customAttributeKeys: {
		req: 'request',
		res: 'response',
		err: 'error',
		responseTime: 'responseTimeMs'
	}
});

app.use(httpLogger);

app.get("/", async (req, res) => {
	const startTime = Date.now();

	// Check common headers used by proxies/load balancers for real client IP
	const ipHeaders = [
		'x-forwarded-for',
		'x-real-ip',
		'x-client-ip',
		'cf-connecting-ip',
		'x-forwarded',
		'forwarded-for',
		'x-cluster-client-ip'
	];

	let ip = null;
	let ipSource = null;

	// Find first available IP header
	for (const header of ipHeaders) {
		const headerValue = req.headers[header];
		if (headerValue) {
			ipSource = header;
			// x-forwarded-for can contain comma-separated IPs, take the first one
			if (header === 'x-forwarded-for') {
				ip = headerValue.split(',')[0].trim();
			} else if (header === 'x-real-ip' && headerValue.startsWith("\\")) {
				// Handle escaped IP addresses
				ip = headerValue.slice(1);
			} else {
				ip = headerValue;
			}
			break;
		}
	}

	// If no IP found, use remote address as fallback
	if (!ip) {
		ip = req.connection?.remoteAddress || req.socket?.remoteAddress;
		ipSource = 'connection';
	}

	const ua = req.headers["user-agent"];
	const isNewUserAgent = !user_agents[ua];
	if (!user_agents[ua]) user_agents[ua] = 0;
	user_agents[ua]++;

	// Log user agent metrics
	logger.info({
		event: 'user_agent_tracking',
		userAgent: ua,
		isNewUserAgent,
		totalOccurrences: user_agents[ua],
		totalUniqueUserAgents: Object.keys(user_agents).length
	}, 'User agent tracked');

	// Log IP detection metrics
	logger.info({
		event: 'ip_detection',
		clientIp: ip,
		ipSource,
		hasProxyHeaders: !!ipSource && ipSource !== 'connection'
	}, `Client IP detected via ${ipSource || 'connection'}`);

	let reverseLookup;
	let dnsLookupTime = null;
	if (ip) {
		const dnsStart = Date.now();
		try {
			reverseLookup = await reverseDns(ip);
			dnsLookupTime = Date.now() - dnsStart;

			logger.info({
				event: 'dns_lookup_success',
				clientIp: ip,
				reverseDns: reverseLookup,
				lookupTimeMs: dnsLookupTime
			}, 'DNS reverse lookup successful');
		} catch (err) {
			dnsLookupTime = Date.now() - dnsStart;

			logger.warn({
				event: 'dns_lookup_failure',
				clientIp: ip,
				lookupTimeMs: dnsLookupTime,
				error: err.message
			}, 'DNS reverse lookup failed');
		}
	}

	// If IP still not found, include all headers for debugging
	const response = {
		...req.headers,
		currentTs: new Date(),
		ip,
		reverseLookup,
	};

	if (!ip) {
		response.debug = {
			message: "Could not determine client IP",
			allHeaders: req.headers,
			remoteAddress: req.connection?.remoteAddress,
			socketRemoteAddress: req.socket?.remoteAddress
		};

		logger.warn({
			event: 'ip_detection_failure',
			headers: Object.keys(req.headers),
			remoteAddress: req.connection?.remoteAddress,
			socketRemoteAddress: req.socket?.remoteAddress
		}, 'Failed to determine client IP');
	}

	// Log performance metrics
	const totalRequestTime = Date.now() - startTime;
	logger.info({
		event: 'request_performance',
		totalRequestTimeMs: totalRequestTime,
		dnsLookupTimeMs: dnsLookupTime,
		clientIp: ip,
		hasReverseDns: !!reverseLookup
	}, 'Request processing completed');

	res.json(response);
});

app.get("/user-agents", (req, res) => {
	const uniqueCount = Object.keys(user_agents).length;
	const totalRequests = Object.values(user_agents).reduce((sum, count) => sum + count, 0);

	logger.info({
		event: 'user_agents_endpoint_accessed',
		uniqueUserAgents: uniqueCount,
		totalRequests
	}, 'User agents data accessed');

	res.send(user_agents);
});

app.get("/alb-health-check", (req, res) => {
	res.send("ok");
});

app.use(function (req, res) {
	logger.warn({
		event: 'route_not_found',
		method: req.method,
		url: req.url,
		userAgent: req.headers['user-agent'],
		clientIp: req.ip || req.connection?.remoteAddress
	}, `404 - Route not found: ${req.method} ${req.url}`);

	res.status(404).send("404: Page not Found");
});

app.use(function (error, req, res, next) {
	logger.error({
		event: 'server_error',
		error: {
			message: error.message,
			stack: error.stack,
			name: error.name
		},
		method: req.method,
		url: req.url,
		userAgent: req.headers['user-agent'],
		clientIp: req.ip || req.connection?.remoteAddress
	}, `500 - Internal server error: ${error.message}`);

	res.status(500).send("500: Internal Server Error");
});

// Periodic metrics logging for business intelligence
setInterval(() => {
	const memUsage = process.memoryUsage();
	const uniqueUserAgents = Object.keys(user_agents).length;
	const totalRequests = Object.values(user_agents).reduce((sum, count) => sum + count, 0);

	logger.info({
		event: 'periodic_metrics',
		metrics: {
			memory: {
				rss: memUsage.rss,
				heapTotal: memUsage.heapTotal,
				heapUsed: memUsage.heapUsed,
				external: memUsage.external
			},
			userAgents: {
				unique: uniqueUserAgents,
				totalRequests
			},
			uptime: process.uptime()
		}
	}, 'Periodic service metrics');
}, 60000); // Log every minute

app.listen(port, () => {
	logger.info({
		event: 'service_startup',
		port,
		nodeVersion: process.version,
		environment: process.env.NODE_ENV || 'development',
		processId: process.pid
	}, `Service started on port: ${port}`);
});

async function reverseDns(ip) {
	return new Promise((resolve, reject) => {
		dns.reverse(ip, (err, address, family) => {
			if (err) {
				reject(err);
			} else {
				resolve(address[0]);
			}
		});
	});
}
