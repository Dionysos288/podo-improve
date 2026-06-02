#!/usr/bin/env node
import { main } from './src/cli.mjs';
import { log } from './src/log.mjs';

main(process.argv).catch((err) => {
	log.error('Fatal error:', err);
	process.exit(1);
});
