import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';

export type UsageEventType =
	| 'STL_UPLOADED'
	| 'PRINT_STARTED'
	| 'PROJECT_OPENED'
	| 'DESIGN_OPENED'
	| 'DESIGN_CREATED';

export type UsageSummary = Record<UsageEventType, number>;

export const USAGE_EVENT_LABELS: Record<UsageEventType, string> = {
	STL_UPLOADED: 'STL uploads',
	PRINT_STARTED: 'Prints gestart',
	PROJECT_OPENED: 'Projecten geopend',
	DESIGN_OPENED: 'Ontwerpen geopend',
	DESIGN_CREATED: 'Ontwerpen aangemaakt',
};

export function createEmptyUsageSummary(): UsageSummary {
	return {
		STL_UPLOADED: 0,
		PRINT_STARTED: 0,
		PROJECT_OPENED: 0,
		DESIGN_OPENED: 0,
		DESIGN_CREATED: 0,
	};
}

export async function recordUsageEvent(input: {
	orgId: string;
	userId?: string | null;
	eventType: UsageEventType;
	quantity?: number;
	resourceId?: string | null;
	metadata?: Prisma.InputJsonValue;
}) {
	const prismaAny = prisma as unknown as {
		usageEvent: {
			create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
			groupBy: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
		};
	};

	await prismaAny.usageEvent.create({
		data: {
			orgId: input.orgId,
			userId: input.userId ?? null,
			eventType: input.eventType,
			quantity: input.quantity ?? 1,
			resourceId: input.resourceId ?? null,
			metadata: input.metadata ?? {},
		},
	});
}

export async function getOrganizationUsageSummary(orgId: string) {
	const prismaAny = prisma as unknown as {
		usageEvent: {
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ eventType: UsageEventType; _sum: { quantity: number | null } }>>;
		};
	};

	const grouped = await prismaAny.usageEvent.groupBy({
		by: ['eventType'],
		where: { orgId },
		_sum: { quantity: true },
	});

	const summary = createEmptyUsageSummary();
	for (const row of grouped) {
		summary[row.eventType] = row._sum.quantity ?? 0;
	}
	return summary;
}

export async function getUserUsageSummary(orgId: string, userId: string) {
	const prismaAny = prisma as unknown as {
		usageEvent: {
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ eventType: UsageEventType; _sum: { quantity: number | null } }>>;
		};
	};

	const grouped = await prismaAny.usageEvent.groupBy({
		by: ['eventType'],
		where: { orgId, userId },
		_sum: { quantity: true },
	});

	const summary = createEmptyUsageSummary();
	for (const row of grouped) {
		summary[row.eventType] = row._sum.quantity ?? 0;
	}
	return summary;
}

export async function getOrganizationUsageByUser(orgId: string) {
	const prismaAny = prisma as unknown as {
		usageEvent: {
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ userId: string | null; eventType: UsageEventType; _sum: { quantity: number | null } }>>;
		};
	};

	const rows = await prismaAny.usageEvent.groupBy({
		by: ['userId', 'eventType'],
		where: { orgId },
		_sum: { quantity: true },
	});

	const map = new Map<string, UsageSummary>();
	for (const row of rows) {
		if (!row.userId) continue;
		const current = map.get(row.userId) ?? createEmptyUsageSummary();
		current[row.eventType] = row._sum.quantity ?? 0;
		map.set(row.userId, current);
	}
	return map;
}

export async function getCurrentStlUsage(orgId: string) {
	return prisma.scan.count({
		where: {
			project: {
				patient: { orgId },
				deletedAt: null,
			},
		},
	});
}
