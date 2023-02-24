const express = require("express");
const morgan = require("morgan");

const app = express();
const port = process.env.PORT || 3000;

const dns = require("dns");

let user_agents = {};

app.use(morgan("combined"));

app.get("/", async (req, res) => {
	// ALB uses x-forwarded-for
	// nginx uses x-real-ip
	const ip =
		req.headers["x-forwarded-for"] ??
		(req.headers["x-real-ip"].startsWith("\\") ? req.headers["x-real-ip"].slice(1) : req.headers["x-real-ip"]);

	const ua = req.headers["user-agent"];
	if (!user_agents[ua]) user_agents[ua] = 0;
	user_agents[ua]++;
	let reverseLookup;
	try {
		reverseLookup = await reverseDns(ip);
	} catch (err) {
		// Do nothing
	}
	res.json({
		...req.headers,
		currentTs: new Date(),
		ip,
		reverseLookup,
	});
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
