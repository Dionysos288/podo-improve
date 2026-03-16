'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requirePlatformAdmin } from '@/src/shared/core/auth/admin';
import {
	createRegistrationAccessKey,
	deleteRegistrationAccessKey,
	getEffectiveAccessKeyStatus,
	listRegistrationAccessKeys,
} from '@/src/shared/core/platform/access-keys';
import {
	getCurrentStlUsage,
	getOrganizationUsageSummary,
	getOrganizationUsageByUser,
	getUserUsageSummary,
} from '@/src/shared/core/platform/usage';
import { normalizeStlLimit, type CompanyPlan } from '@/src/shared/core/platform/plans';
import { requireOrganization, requireSession } from '@/src/shared/core/auth/get-session';

export async function getPlatformDashboardData() {
	await requirePlatformAdmin();
	const prismaAny = prisma as unknown as {
		organization: {
			findMany: (args: Record<string, unknown>) => Promise<Array<{
				id: string;
				name: string;
				slug: string;
				plan: CompanyPlan;
				stlLimit: number;
				billingStatus: string | null;
				contractStartDate: Date | null;
				isActive: boolean;
				closedAt: Date | null;
				closedReason: string | null;
				createdAt: Date;
				users: Array<{ id: string; name: string; email: string; role: 'ADMIN' | 'DOCTOR'; createdAt: Date }>;
				_count: { patients: number; printers: number };
			}>>;
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
			findUnique: (args: Record<string, unknown>) => Promise<{
				id: string;
				name: string;
				slug: string;
				plan: CompanyPlan;
				stlLimit: number;
				billingStatus: string | null;
				contractStartDate: Date | null;
				isActive: boolean;
				closedAt: Date | null;
				closedReason: string | null;
			} | null>;
		};
	};

	const organizations = await prismaAny.organization.findMany({
		orderBy: { createdAt: 'desc' },
		include: {
			users: {
				select: { id: true, name: true, email: true, role: true, createdAt: true },
				orderBy: { createdAt: 'asc' },
			},
			_count: {
				select: {
					patients: true,
					printers: true,
				},
			},
		},
	});

	const enrichedOrganizations = await Promise.all(
		organizations.map(async (organization) => {
			const [stlUsage, projectCount, designCount, usageSummary, usageByUser] = await Promise.all([
				getCurrentStlUsage(organization.id),
				prisma.project.count({ where: { patient: { orgId: organization.id }, deletedAt: null } }),
				prisma.design.count({ where: { project: { patient: { orgId: organization.id } }, deletedAt: null } }),
				getOrganizationUsageSummary(organization.id),
				getOrganizationUsageByUser(organization.id),
			]);

			const contractEndDate = organization.contractStartDate
				? new Date(new Date(organization.contractStartDate).setFullYear(new Date(organization.contractStartDate).getFullYear() + 1))
				: null;

			return {
				...organization,
				stlUsage,
				projectCount,
				designCount,
				usageSummary,
				contractEndDate,
				userUsage: organization.users.map((user) => ({
					...user,
					usageSummary: usageByUser.get(user.id) ?? null,
				})),
			};
		})
	);

	const accessKeys = await listRegistrationAccessKeys();

	return {
		organizations: enrichedOrganizations,
		accessKeys: accessKeys.map((key) => ({
			...key,
			effectiveStatus: getEffectiveAccessKeyStatus(key.status, key.expiresAt),
		})),
	};
}

export async function createPlatformAccessKeyAction(input: {
	plan: CompanyPlan;
	stlLimit?: number | null;
	label?: string;
	createdForEmail?: string;
	notes?: string;
}) {
	const { user } = await requirePlatformAdmin();

	return createRegistrationAccessKey({
		plan: input.plan,
		stlLimit: input.stlLimit,
		label: input.label,
		createdForEmail: input.createdForEmail,
		notes: input.notes,
		issuedById: user.id,
	});
}

export async function deletePlatformAccessKeyAction(keyId: string) {
	await requirePlatformAdmin();
	return deleteRegistrationAccessKey(keyId);
}

export async function updateOrganizationPlanAction(input: {
	organizationId: string;
	plan: CompanyPlan;
	stlLimit?: number | null;
}) {
	await requirePlatformAdmin();

	const prismaAny = prisma as unknown as {
		organization: {
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
		};
	};

	return prismaAny.organization.update({
		where: { id: input.organizationId },
		data: {
			plan: input.plan,
			stlLimit: normalizeStlLimit(input.plan, input.stlLimit),
		},
	});
}

export async function updateOrganizationDeadlineAction(input: {
	organizationId: string;
	contractEndDate: string | null;
}) {
	await requirePlatformAdmin();

	const prismaAny = prisma as unknown as {
		organization: {
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
		};
	};

	// contractEndDate is the deadline. We store contractStartDate as 1 year before deadline.
	const endDate = input.contractEndDate ? new Date(input.contractEndDate) : null;
	const startDate = endDate
		? new Date(new Date(endDate).setFullYear(endDate.getFullYear() - 1))
		: null;

	return prismaAny.organization.update({
		where: { id: input.organizationId },
		data: {
			contractStartDate: startDate,
		},
	});
}

export async function updateOrganizationAccessAction(input: {
	organizationId: string;
	isActive: boolean;
	closedReason?: string | null;
}) {
	await requirePlatformAdmin();

	const prismaAny = prisma as unknown as {
		organization: {
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
		};
	};

	return prismaAny.organization.update({
		where: { id: input.organizationId },
		data: {
			isActive: input.isActive,
			closedAt: input.isActive ? null : new Date(),
			closedReason: input.isActive ? null : input.closedReason?.trim() || null,
		},
	});
}

export async function getSettingsUsageData() {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	const prismaAny = prisma as unknown as {
		organization: {
			findUnique: (args: Record<string, unknown>) => Promise<{
				id: string;
				name: string;
				slug: string;
				plan: CompanyPlan;
				stlLimit: number;
				billingStatus: string | null;
				contractStartDate: Date | null;
				isActive: boolean;
				closedAt: Date | null;
				closedReason: string | null;
			} | null>;
		};
	};

	const [organization, stlUsage, orgUsageSummary, userUsageSummary] = await Promise.all([
		prismaAny.organization.findUnique({
			where: { id: orgId },
			select: {
				id: true,
				name: true,
				slug: true,
				plan: true,
				stlLimit: true,
				billingStatus: true,
				contractStartDate: true,
				isActive: true,
				closedAt: true,
				closedReason: true,
			},
		}),
		getCurrentStlUsage(orgId),
		getOrganizationUsageSummary(orgId),
		getUserUsageSummary(orgId, session.user.id),
	]);

	if (!organization) {
		throw new Error('Organisatie niet gevonden');
	}

	return {
		organization,
		stlUsage,
		orgUsageSummary,
		userUsageSummary,
	};
}

export type PlatformDashboardData = Awaited<ReturnType<typeof getPlatformDashboardData>>;
