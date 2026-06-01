import { UsageEventType, type Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';

export { UsageEventType };

type UsageEventTypeName = (typeof UsageEventType)[keyof typeof UsageEventType];

export type UsageSummary = Record<UsageEventTypeName, number>;

export const USAGE_EVENT_LABELS: Record<UsageEventTypeName, string> = {
	STL_UPLOADED: 'STL uploads',
	STL_EXPORTED: 'STL / G-code exports',
	PRINT_STARTED: 'Prints gestart',
	PROJECT_OPENED: 'Projecten geopend',
	DESIGN_OPENED: 'Ontwerpen geopend',
	DESIGN_CREATED: 'Ontwerpen aangemaakt',
};

export function createEmptyUsageSummary(): UsageSummary {
	return {
		STL_UPLOADED: 0,
		STL_EXPORTED: 0,
		PRINT_STARTED: 0,
		PROJECT_OPENED: 0,
		DESIGN_OPENED: 0,
		DESIGN_CREATED: 0,
	};
}

export async function recordUsageEvent(input: {
	orgId: string;
	userId?: string | null;
	eventType: UsageEventTypeName;
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
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ eventType: UsageEventTypeName; _sum: { quantity: number | null } }>>;
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
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ eventType: UsageEventTypeName; _sum: { quantity: number | null } }>>;
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
			groupBy: (args: Record<string, unknown>) => Promise<Array<{ userId: string | null; eventType: UsageEventTypeName; _sum: { quantity: number | null } }>>;
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
	const [scanCount, exportAggregate] = await Promise.all([
		prisma.scan.count({
			where: {
				project: {
					patient: { orgId },
					deletedAt: null,
				},
			},
		}),
		prisma.usageEvent.aggregate({
			where: { orgId, eventType: UsageEventType.STL_EXPORTED },
			_sum: { quantity: true },
		}),
	]);
	return scanCount + (exportAggregate._sum.quantity ?? 0);
}
