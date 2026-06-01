import { defineConfig } from 'prisma/config';
import 'dotenv/config';

// `prisma generate` only needs a valid URL at build time. Vercel/CI may not inject
// DATABASE_URL until you configure project env vars — use a placeholder so builds
// still succeed; runtime requires real DATABASE_URL and DIRECT_URL.
const databaseUrl =
	process.env.DATABASE_URL ??
	'postgresql://build:build@127.0.0.1:5432/build?schema=public';
const directUrl = process.env.DIRECT_URL ?? databaseUrl;

export default defineConfig({
	schema: 'src/prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
	},
	engine: 'classic',
	datasource: {
		url: databaseUrl,
		directUrl,
	},
});
