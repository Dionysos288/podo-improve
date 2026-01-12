#!/usr/bin/env node

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--url') args.url = argv[++i];
		else if (a === '--token') args.token = argv[++i];
	}
	return args;
}

const { url, token } = parseArgs(process.argv);

if (!url || !token) {
	console.error(
		'Usage: node agent/print-agent/ping.mjs --url http://localhost:3000 --token YOUR_TOKEN'
	);
	process.exit(1);
}

const res = await fetch(`${url.replace(/\/$/, '')}/api/agent/ping`, {
	method: 'POST',
	headers: {
		authorization: `Bearer ${token}`,
	},
});

const text = await res.text();
if (!res.ok) {
	console.error(`Ping failed (${res.status}): ${text}`);
	process.exit(1);
}

console.log('Agent ping OK:', text);
