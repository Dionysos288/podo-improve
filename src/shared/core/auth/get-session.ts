import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from './auth';
import { prisma } from '@/src/shared/core/db/prisma';

/**
 * Get the current session on the server side
 * Use this in Server Components and Server Actions
 * Wrapped in React.cache() for per-request deduplication
 */
export const getServerSession = cache(async () => {
	const session = await auth.api.getSession({
		headers: await headers(),
	});
	return session;
});

/**
 * Get the current session or throw an error if not authenticated
 * Wrapped in React.cache() for per-request deduplication
 */
export const requireSession = cache(async () => {
	const session = await getServerSession();
	if (!session) {
		throw new Error('Unauthorized');
	}
	return session;
});

/**
 * Get the current user's organization ID or throw if not set
 * Fetches from database to ensure orgId is current
 * Wrapped in React.cache() for per-request deduplication
 */
export const requireOrganization = cache(async () => {
	const session = await requireSession();

	// Fetch user from database to get current orgId (session might not have it)
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { orgId: true },
	});

	if (!user || !user.orgId) {
		throw new Error('No organization associated with user');
	}

	return { session, orgId: user.orgId };
});
