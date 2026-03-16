import { prisma } from '@/src/shared/core/db/prisma';

export class OrganizationClosedError extends Error {
	constructor(message = 'Deze organisatie is gesloten. Neem contact op met de beheerder.') {
		super(message);
		this.name = 'OrganizationClosedError';
	}
}

export async function getOrganizationAccessState(orgId: string) {
	const prismaAny = prisma as unknown as {
		organization: {
			findUnique: (args: { where: { id: string }; select: Record<string, boolean> }) => Promise<{
				id: string;
				name: string;
				slug: string;
				isActive: boolean;
				closedAt: Date | null;
				closedReason: string | null;
			} | null>;
		};
	};

	return prismaAny.organization.findUnique({
		where: { id: orgId },
		select: {
			id: true,
			name: true,
			slug: true,
			isActive: true,
			closedAt: true,
			closedReason: true,
		},
	});
}

export async function assertOrganizationIsActive(orgId: string) {
	const organization = await getOrganizationAccessState(orgId);

	if (!organization) {
		throw new Error('Organisatie niet gevonden');
	}

	if (!organization.isActive) {
		throw new OrganizationClosedError(
			organization.closedReason?.trim() || 'Deze organisatie is gesloten. Neem contact op met de beheerder.'
		);
	}

	return organization;
}
