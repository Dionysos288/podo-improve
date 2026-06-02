import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

function createPrismaClient() {
	return new PrismaClient({
		log:
			process.env.NODE_ENV === 'development'
				? ['query', 'error', 'warn']
				: ['error'],
	});
}

/** After schema changes, Next.js dev can keep an old PrismaClient on globalThis. */
function isStalePrismaClient(client: PrismaClient): boolean {
	const delegate = (client as PrismaClient & { printMaterial?: { count?: unknown } })
		.printMaterial;
	return typeof delegate?.count !== 'function';
}

function getPrismaClient(): PrismaClient {
	const cached = globalForPrisma.prisma;
	if (cached && !isStalePrismaClient(cached)) {
		return cached;
	}
	const client = createPrismaClient();
	if (process.env.NODE_ENV !== 'production') {
		globalForPrisma.prisma = client;
	}
	return client;
}

export const prisma = getPrismaClient();
