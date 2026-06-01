import { UsageEventType } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';
import { getCurrentStlUsage, recordUsageEvent } from '@/src/shared/core/platform/usage';

export type StlExportKind =
	| 'stl_left'
	| 'stl_right'
	| 'stl_pair'
	| 'gcode'
	| 'nc';

export class StlQuotaExceededError extends Error {
	readonly status = 403;

	constructor(public readonly stlLimit: number) {
		super(`STL limiet bereikt (${stlLimit}). Neem contact op voor een upgrade.`);
		this.name = 'StlQuotaExceededError';
	}
}

export async function getOrganizationStlLimit(orgId: string): Promise<number> {
	const organization = await prisma.organization.findUnique({
		where: { id: orgId },
		select: { stlLimit: true },
	});
	return organization?.stlLimit ?? 200;
}

export async function assertStlQuotaAvailable(orgId: string): Promise<{
	stlLimit: number;
	stlUsage: number;
}> {
	const [stlLimit, stlUsage] = await Promise.all([
		getOrganizationStlLimit(orgId),
		getCurrentStlUsage(orgId),
	]);
	if (stlUsage >= stlLimit) {
		throw new StlQuotaExceededError(stlLimit);
	}
	return { stlLimit, stlUsage };
}

export async function recordStlExport(input: {
	orgId: string;
	userId: string;
	exportKind: StlExportKind;
	projectId?: string | null;
	designId?: string | null;
	resourceId?: string | null;
}) {
	await recordUsageEvent({
		orgId: input.orgId,
		userId: input.userId,
		eventType: UsageEventType.STL_EXPORTED,
		quantity: 1,
		resourceId: input.resourceId ?? input.projectId ?? null,
		metadata: {
			exportKind: input.exportKind,
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.designId ? { designId: input.designId } : {}),
		},
	});
}

export async function assertStlQuotaAndRecordExport(input: {
	orgId: string;
	userId: string;
	exportKind: StlExportKind;
	projectId?: string | null;
	designId?: string | null;
	resourceId?: string | null;
}) {
	await assertStlQuotaAvailable(input.orgId);
	await recordStlExport(input);
	const stlUsage = await getCurrentStlUsage(input.orgId);
	const stlLimit = await getOrganizationStlLimit(input.orgId);
	return { stlUsage, stlLimit };
}
