import { runAgent } from './runner.mjs';
import { install, uninstall } from './install.mjs';
import { maybeSelfUpdate } from './updater.mjs';
import { createApi } from './api.mjs';
import { loadConfig } from './config.mjs';
import { log } from './log.mjs';
import { AGENT_VERSION } from './version.mjs';

function parseFlags(args) {
	const flags = {};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--url') flags.url = args[++i];
		else if (a === '--token') flags.token = args[++i];
		else if (a === '--prusa' || a === '--prusaSlicerPath') flags.prusa = args[++i];
	}
	return flags;
}

function printUsage() {
	log.info(
		[
			`Podo Improve Print Agent v${AGENT_VERSION}`,
			'',
			'Usage:',
			'  podo-print-agent                      run the agent (default)',
			'  podo-print-agent install --url <url> --token <token> [--prusa <path>]',
			'  podo-print-agent uninstall            remove auto-start + config',
			'  podo-print-agent update               check for and apply updates',
		].join('\n')
	);
}

export async function main(argv) {
	const [, , cmd, ...rest] = argv;
	const flags = parseFlags(rest);

	switch (cmd) {
		case undefined:
		case 'run':
			return runAgent(
				flags.url && flags.token
					? { url: flags.url, token: flags.token, prusaSlicerPath: flags.prusa }
					: undefined
			);
		case 'install':
			install({ url: flags.url, token: flags.token, prusaSlicerPath: flags.prusa });
			return;
		case 'uninstall':
			uninstall();
			return;
		case 'update': {
			const config = loadConfig();
			if (!config) {
				log.error('Agent is not installed.');
				process.exit(1);
			}
			const did = await maybeSelfUpdate(createApi(config), null);
			if (!did) log.info('Agent is up to date.');
			return;
		}
		case 'help':
		case '--help':
		case '-h':
			printUsage();
			return;
		default:
			log.error('Unknown command:', cmd);
			printUsage();
			process.exit(1);
	}
}
