import { prisma } from '@/src/shared/core/db/prisma';
import { getServerSession } from './get-session';

export const PLATFORM_ADMIN_EMAILS = new Set([
	'zenelidion288@gmail.com',
	'zenelidion2888@gmail.com',
]);

export function isPlatformAdminEmail(email?: string | null) {
	if (!email) return false;
	const normalized = email.toLowerCase();
	if (normalized.endsWith('@podoimprove.be')) return true;
	return PLATFORM_ADMIN_EMAILS.has(normalized);
}

export async function getPlatformAdminContext() {
	const session = await getServerSession();
	if (!session) return null;

	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: {
			id: true,
			email: true,
			name: true,
			orgId: true,
			role: true,
		},
	});

	if (!user || !isPlatformAdminEmail(user.email)) {
		return null;
	}

	return { session, user };
}

export async function requirePlatformAdmin() {
	const context = await getPlatformAdminContext();
	if (!context) {
		throw new Error('Alleen platform admins hebben toegang tot dit onderdeel');
	}
	return context;
}
