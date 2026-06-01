import { spawnSync } from 'node:child_process';

// Schema requires DIRECT_URL; mirror DATABASE_URL at generate time if unset (build/CI).
if (!process.env.DIRECT_URL?.trim() && process.env.DATABASE_URL?.trim()) {
	process.env.DIRECT_URL = process.env.DATABASE_URL.trim();
}

const result = spawnSync('prisma', ['generate'], {
	stdio: 'inherit',
	shell: true,
});

process.exit(result.status === 0 ? 0 : 1);
