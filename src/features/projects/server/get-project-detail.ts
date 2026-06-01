import { cache } from 'react';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';

/**
 * Detail-shaped, request-deduplicated project loader for the project detail page.
 * Selects only the fields the page renders; in particular it omits the large
 * design JSON columns (parameters/elements/landmarks/scanMetadata/clientSettings).
 * Returns null when not found so the caller decides on notFound().
 */
export const getProjectDetail = cache(async (id: string) => {
	const { orgId } = await requireOrganization();

	return prisma.project.findFirst({
		where: {
			id,
			patient: { orgId },
			deletedAt: null,
		},
		select: {
			id: true,
			name: true,
			status: true,
			date: true,
			createdAt: true,
			patient: {
				select: { id: true, firstName: true, lastName: true },
			},
			doctor: {
				select: { id: true, name: true },
			},
			scans: {
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					name: true,
					pairId: true,
					footSide: true,
					stlUrl: true,
					createdAt: true,
				},
			},
			designs: {
				where: { deletedAt: null },
				orderBy: { version: 'desc' },
				select: {
					id: true,
					version: true,
					createdAt: true,
					stlUrl: true,
				},
			},
		},
	});
});
