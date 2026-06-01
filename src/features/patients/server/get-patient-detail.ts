import { cache } from 'react';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';

/**
 * Request-deduplicated patient loader for the patient detail page so the query
 * runs once across generateMetadata and the page body. Selects only fields the
 * page renders. Returns null when not found so the caller decides on notFound().
 */
export const getPatientDetail = cache(async (id: string) => {
	const { orgId } = await requireOrganization();

	return prisma.patient.findFirst({
		where: {
			id,
			orgId,
			deletedAt: null,
		},
		select: {
			id: true,
			firstName: true,
			lastName: true,
			birthDate: true,
			notes: true,
			createdAt: true,
			projects: {
				where: { deletedAt: null },
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					name: true,
					status: true,
					date: true,
					doctor: { select: { name: true } },
				},
			},
		},
	});
});
