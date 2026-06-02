#!/usr/bin/env node

/**
 * Legacy entry point.
 *
 * The agent has been modularized under `src/` and is normally shipped as a
 * single executable (`index.mjs` is the packaged entry). This shim keeps older
 * launchers working: `node agent.mjs --url <url> --token <token>` runs the
 * agent with an in-memory config (no install). New setups use the .exe and
 * Task Scheduler — see README.md.
 */
import { runAgent } from './src/runner.mjs';
import { log } from './src/log.mjs';

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--url') args.url = argv[++i];
		else if (a === '--token') args.token = argv[++i];
		else if (a === '--prusa' || a === '--prusaSlicerPath') args.prusa = argv[++i];
	}
	return args;
}

const { url, token, prusa } = parseArgs(process.argv);

runAgent(url && token ? { url, token, prusaSlicerPath: prusa } : undefined).catch((err) => {
	log.error('Fatal error:', err);
	process.exit(1);
});
