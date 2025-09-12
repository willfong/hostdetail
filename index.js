const express = require("express");
const morgan = require("morgan");

const app = express();
const port = process.env.PORT || 3000;

const dns = require("dns");

let user_agents = {};

app.use(morgan("combined"));

app.get("/", async (req, res) => {
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
	
	// Find first available IP header
	for (const header of ipHeaders) {
		const headerValue = req.headers[header];
		if (headerValue) {
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
	}

	const ua = req.headers["user-agent"];
	if (!user_agents[ua]) user_agents[ua] = 0;
	user_agents[ua]++;
	
	let reverseLookup;
	if (ip) {
		try {
			reverseLookup = await reverseDns(ip);
		} catch (err) {
			// Do nothing
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
	}

	res.json(response);
});

app.get("/user-agents", (req, res) => {
	res.send(user_agents);
});

app.get("/alb-health-check", (req, res) => {
	res.send("ok");
});

app.use(function (req, res) {
	res.status(404).send("404: Page not Found");
});

app.use(function (error, req, res, next) {
	console.log(error);
	res.status(500).send("500: Internal Server Error");
});

app.listen(port, () => {
	console.log(`Service started on port: ${port}`);
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
