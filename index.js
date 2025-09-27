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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
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
            color: #4a5568;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .ip-display {
            font-size: 2em;
            color: #667eea;
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
            background: #f7fafc;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        .info-label {
            font-weight: 600;
            color: #4a5568;
            margin-bottom: 5px;
        }
        .info-value {
            color: #2d3748;
            word-break: break-all;
        }
        .geo-section {
            background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            color: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .geo-section h3 { margin-bottom: 15px; }
        .timestamp {
            text-align: center;
            color: #718096;
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
                ${reverseLookup ? `<div style="color: #718096;">→ ${reverseLookup}</div>` : ''}
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

		// Geolocation lookup with timeout
		const geoStart = Date.now();
		try {
			geolocation = await getGeolocation(ip);
			geoLookupTime = Date.now() - geoStart;

			logger.info({
				event: 'geolocation_lookup_success',
				clientIp: ip,
				country: geolocation.country,
				countryCode: geolocation.countryCode,
				region: geolocation.regionName,
				city: geolocation.city,
				isp: geolocation.isp,
				lookupTimeMs: geoLookupTime
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

async function getGeolocation(ip) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

	try {
		const response = await fetch(`http://ip-api.com/json/${ip}`, {
			signal: controller.signal
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();

		if (data.status === 'fail') {
			throw new Error(data.message || 'Geolocation lookup failed');
		}

		return data;
	} catch (error) {
		clearTimeout(timeoutId);
		if (error.name === 'AbortError') {
			throw new Error('Geolocation lookup timeout (2s)');
		}
		throw error;
	}
}
