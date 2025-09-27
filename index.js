const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");
const redis = require("redis");

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

// Redis client setup
const redisClient = redis.createClient({
	url: process.env.REDIS_URL || 'redis://localhost:6379',
	socket: {
		connectTimeout: 5000,
		commandTimeout: 2000,
		reconnectDelayOnFailover: 100,
		reconnectDelayOnClusterDown: 100,
		maxRetriesPerRequest: 3
	},
	retryDelayOnFailover: 100,
	retryDelayOnClusterDown: 100,
	maxRetriesPerRequest: 3,
	lazyConnect: true
});

// Redis error handling
redisClient.on('error', (err) => {
	logger.warn({
		event: 'redis_connection_error',
		error: err.message
	}, 'Redis connection error - continuing without cache');
});

redisClient.on('connect', () => {
	logger.info({
		event: 'redis_connected'
	}, 'Redis cache connected successfully');
});

// Connect to Redis (non-blocking)
redisClient.connect().catch(err => {
	logger.warn({
		event: 'redis_connection_failed',
		error: err.message
	}, 'Failed to connect to Redis - continuing without cache');
});

// Cache configuration - configurable via environment variables
const CACHE_TTL = {
	DNS: parseInt(process.env.CACHE_TTL_DAYS || '30') * 24 * 60 * 60, // Default 30 days for DNS
	GEO: parseInt(process.env.CACHE_TTL_DAYS || '30') * 24 * 60 * 60  // Default 30 days for geolocation
};

// Helper function to safely interact with Redis
async function getFromCache(key) {
	try {
		if (!redisClient.isReady) return null;
		return await redisClient.get(key);
	} catch (err) {
		logger.warn({
			event: 'redis_get_error',
			key,
			error: err.message
		}, 'Redis GET failed');
		return null;
	}
}

async function setCache(key, value, ttl) {
	try {
		if (!redisClient.isReady) return false;
		await redisClient.setEx(key, ttl, JSON.stringify(value));
		return true;
	} catch (err) {
		logger.warn({
			event: 'redis_set_error',
			key,
			error: err.message
		}, 'Redis SET failed');
		return false;
	}
}

// Function to detect if request is from a browser
function isBrowserRequest(userAgent) {
	if (!userAgent) return false;

	const browserPatterns = [
		/mozilla/i,
		/chrome/i,
		/safari/i,
		/firefox/i,
		/edge/i,
		/opera/i,
		/webkit/i
	];

	// Exclude common non-browser user agents
	const nonBrowserPatterns = [
		/curl/i,
		/wget/i,
		/python/i,
		/node/i,
		/java/i,
		/go-http/i,
		/postman/i,
		/insomnia/i,
		/httpie/i,
		/bot/i,
		/spider/i,
		/crawler/i
	];

	// Check if it's a non-browser first
	for (const pattern of nonBrowserPatterns) {
		if (pattern.test(userAgent)) {
			return false;
		}
	}

	// Check if it matches browser patterns
	for (const pattern of browserPatterns) {
		if (pattern.test(userAgent)) {
			return true;
		}
	}

	return false;
}

// Function to generate HTML response
function generateHTML(data) {
	const { ip, reverseLookup, geolocation, currentTs } = data;

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Host Detail - IP Information</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1e3a8a 0%, #374151 100%);
            min-height: 100vh;
            color: #1e3a8a;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .card {
            background: rgba(255,255,255,0.95);
            border-radius: 12px;
            padding: 30px;
            margin: 20px 0;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            backdrop-filter: blur(10px);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #8b5a2b;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .ip-display {
            font-size: 2em;
            color: #1e3a8a;
            font-weight: bold;
            margin: 10px 0;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .info-item {
            background: #f9fafb;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #8b5a2b;
        }
        .info-label {
            font-weight: 600;
            color: #8b5a2b;
            margin-bottom: 5px;
        }
        .info-value {
            color: #1e3a8a;
            word-break: break-all;
        }
        .geo-section {
            background: linear-gradient(135deg, #1e3a8a 0%, #8b5a2b 100%);
            color: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .geo-section h3 { margin-bottom: 15px; }
        .timestamp {
            text-align: center;
            color: #6b7280;
            font-size: 0.9em;
            margin-top: 20px;
        }
        @media (max-width: 600px) {
            .container { padding: 10px; }
            .card { padding: 20px; }
            .header h1 { font-size: 2em; }
            .ip-display { font-size: 1.5em; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="header">
                <h1>🌐 Host Detail</h1>
                <div class="ip-display">${ip || 'Unknown'}</div>
                ${reverseLookup ? `<div style="color: #6b7280;">→ ${reverseLookup}</div>` : ''}
            </div>

            ${geolocation ? `
            <div class="geo-section">
                <h3>📍 Geographic Information</h3>
                <div class="info-grid">
                    <div>
                        <div class="info-label">Country</div>
                        <div class="info-value">${geolocation.country} (${geolocation.countryCode})</div>
                    </div>
                    <div>
                        <div class="info-label">Region</div>
                        <div class="info-value">${geolocation.regionName}</div>
                    </div>
                    <div>
                        <div class="info-label">City</div>
                        <div class="info-value">${geolocation.city}</div>
                    </div>
                    <div>
                        <div class="info-label">Timezone</div>
                        <div class="info-value">${geolocation.timezone}</div>
                    </div>
                    <div>
                        <div class="info-label">ISP</div>
                        <div class="info-value">${geolocation.isp}</div>
                    </div>
                    <div>
                        <div class="info-label">Coordinates</div>
                        <div class="info-value">${geolocation.lat}, ${geolocation.lon}</div>
                    </div>
                </div>
            </div>
            ` : ''}

            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">User Agent</div>
                    <div class="info-value">${data['user-agent'] || 'Unknown'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Host</div>
                    <div class="info-value">${data.host || 'Unknown'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Accept</div>
                    <div class="info-value">${data.accept || 'Unknown'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Connection</div>
                    <div class="info-value">${data.connection || 'Unknown'}</div>
                </div>
            </div>

            <div class="timestamp">
                Last updated: ${new Date(currentTs).toLocaleString()}
            </div>
        </div>
    </div>
</body>
</html>`;
}

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

	// Check if this is a browser request
	const isBrowser = isBrowserRequest(ua);

	// Log user agent metrics
	logger.info({
		event: 'user_agent_tracking',
		userAgent: ua,
		isNewUserAgent,
		isBrowserRequest: isBrowser,
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
	let geolocation = null;
	let geoLookupTime = null;

	if (ip) {
		const dnsStart = Date.now();
		try {
			reverseLookup = await reverseDnsWithCache(ip);
			dnsLookupTime = Date.now() - dnsStart;

			if (reverseLookup) {
				logger.info({
					event: 'dns_lookup_success',
					clientIp: ip,
					reverseDns: reverseLookup,
					lookupTimeMs: dnsLookupTime,
					fromCache: dnsLookupTime < 10 // Likely from cache if very fast
				}, 'DNS reverse lookup successful');
			}
		} catch (err) {
			dnsLookupTime = Date.now() - dnsStart;

			logger.warn({
				event: 'dns_lookup_failure',
				clientIp: ip,
				lookupTimeMs: dnsLookupTime,
				error: err.message
			}, 'DNS reverse lookup failed');
		}

		// Geolocation lookup with timeout
		const geoStart = Date.now();
		try {
			geolocation = await getGeolocationWithCache(ip);
			geoLookupTime = Date.now() - geoStart;

			if (geolocation) {
				logger.info({
					event: 'geolocation_lookup_success',
					clientIp: ip,
					country: geolocation.country,
					countryCode: geolocation.countryCode,
					region: geolocation.regionName,
					city: geolocation.city,
					isp: geolocation.isp,
					lookupTimeMs: geoLookupTime,
					fromCache: geoLookupTime < 10 // Likely from cache if very fast
				}, `Geolocation lookup successful for ${geolocation.country}`);

				// Log country metrics for Grafana
				logger.info({
					event: 'country_metrics',
					country: geolocation.country,
					countryCode: geolocation.countryCode,
					region: geolocation.regionName,
					city: geolocation.city,
					clientIp: ip
				}, `Request from ${geolocation.country}`);
			}
		} catch (err) {
			geoLookupTime = Date.now() - geoStart;

			logger.warn({
				event: 'geolocation_lookup_failure',
				clientIp: ip,
				lookupTimeMs: geoLookupTime,
				error: err.message
			}, 'Geolocation lookup failed');
		}
	}

	// If IP still not found, include all headers for debugging
	const response = {
		...req.headers,
		currentTs: new Date(),
		ip,
		reverseLookup,
		geolocation,
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
		geoLookupTimeMs: geoLookupTime,
		clientIp: ip,
		hasReverseDns: !!reverseLookup,
		hasGeolocation: !!geolocation,
		isBrowserRequest: isBrowser,
		responseFormat: isBrowser ? 'html' : 'json'
	}, 'Request processing completed');

	// Return HTML for browsers, JSON for everything else
	if (isBrowser) {
		res.setHeader('Content-Type', 'text/html');
		res.send(generateHTML(response));
	} else {
		res.json(response);
	}
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

// More efficient health check endpoint
app.get("/health", (req, res) => {
	res.status(200).end();
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

// Cached version of reverse DNS lookup
async function reverseDnsWithCache(ip) {
	const cacheKey = `dns:${ip}`;

	// Try cache first
	const cached = await getFromCache(cacheKey);
	if (cached) {
		try {
			const result = JSON.parse(cached);
			logger.info({
				event: 'cache_hit',
				cacheType: 'dns',
				clientIp: ip,
				cacheKey,
				result
			}, 'DNS cache hit');
			return result;
		} catch (err) {
			logger.warn({
				event: 'cache_parse_error',
				cacheType: 'dns',
				key: cacheKey,
				error: err.message
			}, 'Failed to parse cached DNS result');
		}
	}

	// Cache miss, perform lookup
	logger.info({
		event: 'cache_miss',
		cacheType: 'dns',
		clientIp: ip,
		cacheKey
	}, 'DNS cache miss - performing lookup');

	const result = await reverseDns(ip);
	if (result) {
		const cached = await setCache(cacheKey, result, CACHE_TTL.DNS);
		logger.info({
			event: 'cache_set',
			cacheType: 'dns',
			clientIp: ip,
			cacheKey,
			result,
			ttl: CACHE_TTL.DNS,
			cached
		}, 'DNS result cached');
	}

	return result;
}

// Cached version of geolocation lookup
async function getGeolocationWithCache(ip) {
	const cacheKey = `geo:${ip}`;

	// Try cache first
	const cached = await getFromCache(cacheKey);
	if (cached) {
		try {
			const result = JSON.parse(cached);
			logger.info({
				event: 'cache_hit',
				cacheType: 'geolocation',
				clientIp: ip,
				cacheKey,
				country: result.country,
				countryCode: result.countryCode,
				region: result.regionName,
				city: result.city
			}, 'Geolocation cache hit');
			return result;
		} catch (err) {
			logger.warn({
				event: 'cache_parse_error',
				cacheType: 'geolocation',
				key: cacheKey,
				error: err.message
			}, 'Failed to parse cached geolocation result');
		}
	}

	// Cache miss, perform lookup
	logger.info({
		event: 'cache_miss',
		cacheType: 'geolocation',
		clientIp: ip,
		cacheKey
	}, 'Geolocation cache miss - performing API request');

	const result = await getGeolocation(ip);
	if (result) {
		const cached = await setCache(cacheKey, result, CACHE_TTL.GEO);
		logger.info({
			event: 'cache_set',
			cacheType: 'geolocation',
			clientIp: ip,
			cacheKey,
			country: result.country,
			countryCode: result.countryCode,
			region: result.regionName,
			city: result.city,
			ttl: CACHE_TTL.GEO,
			cached
		}, 'Geolocation result cached');
	}

	return result;
}

async function getGeolocation(ip) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
	const apiUrl = `http://ip-api.com/json/${ip}`;
	const requestStart = Date.now();

	logger.info({
		event: 'third_party_api_request',
		apiProvider: 'ip-api.com',
		apiUrl,
		clientIp: ip,
		requestType: 'geolocation'
	}, 'Making geolocation API request');

	try {
		const response = await fetch(apiUrl, {
			signal: controller.signal
		});

		clearTimeout(timeoutId);
		const requestDuration = Date.now() - requestStart;

		if (!response.ok) {
			logger.warn({
				event: 'third_party_api_error',
				apiProvider: 'ip-api.com',
				apiUrl,
				clientIp: ip,
				requestType: 'geolocation',
				httpStatus: response.status,
				httpStatusText: response.statusText,
				requestDurationMs: requestDuration
			}, `Geolocation API HTTP error: ${response.status}`);
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();

		if (data.status === 'fail') {
			logger.warn({
				event: 'third_party_api_failure',
				apiProvider: 'ip-api.com',
				apiUrl,
				clientIp: ip,
				requestType: 'geolocation',
				apiResponse: data,
				requestDurationMs: requestDuration
			}, `Geolocation API failure: ${data.message || 'Unknown error'}`);
			throw new Error(data.message || 'Geolocation lookup failed');
		}

		logger.info({
			event: 'third_party_api_success',
			apiProvider: 'ip-api.com',
			apiUrl,
			clientIp: ip,
			requestType: 'geolocation',
			country: data.country,
			countryCode: data.countryCode,
			region: data.regionName,
			city: data.city,
			isp: data.isp,
			requestDurationMs: requestDuration
		}, 'Geolocation API request successful');

		return data;
	} catch (error) {
		clearTimeout(timeoutId);
		const requestDuration = Date.now() - requestStart;

		if (error.name === 'AbortError') {
			logger.warn({
				event: 'third_party_api_timeout',
				apiProvider: 'ip-api.com',
				apiUrl,
				clientIp: ip,
				requestType: 'geolocation',
				timeoutMs: 2000,
				requestDurationMs: requestDuration
			}, 'Geolocation API request timeout');
			throw new Error('Geolocation lookup timeout (2s)');
		}

		logger.error({
			event: 'third_party_api_error',
			apiProvider: 'ip-api.com',
			apiUrl,
			clientIp: ip,
			requestType: 'geolocation',
			error: error.message,
			requestDurationMs: requestDuration
		}, `Geolocation API request failed: ${error.message}`);

		throw error;
	}
}
