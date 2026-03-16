import { prisma } from '@/src/shared/core/db/prisma';
import { normalizeStlLimit, type CompanyPlan } from './plans';

type AccessKeyStatus = 'ACTIVE' | 'REDEEMED' | 'DISABLED' | 'EXPIRED';

function generateCode() {
	return `PODO-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function hasMidnightUtcTime(value: Date) {
	return (
		value.getUTCHours() === 0 &&
		value.getUTCMinutes() === 0 &&
		value.getUTCSeconds() === 0 &&
		value.getUTCMilliseconds() === 0
	);
}

export function normalizeAccessKeyExpiry(expiresAt?: Date | null) {
	if (!expiresAt) {
		return null;
	}

	if (!hasMidnightUtcTime(expiresAt)) {
		return expiresAt;
	}

	return new Date(
		Date.UTC(
			expiresAt.getUTCFullYear(),
			expiresAt.getUTCMonth(),
			expiresAt.getUTCDate(),
			23,
			59,
			59,
			999
		)
	);
}

export function isAccessKeyExpired(expiresAt?: Date | null, now = new Date()) {
	const normalizedExpiry = normalizeAccessKeyExpiry(expiresAt);
	return normalizedExpiry ? normalizedExpiry < now : false;
}

export function getEffectiveAccessKeyStatus(status: AccessKeyStatus, expiresAt?: Date | null): AccessKeyStatus {
	if (status === 'ACTIVE' && isAccessKeyExpired(expiresAt)) {
		return 'EXPIRED';
	}

	return status;
}

export async function createRegistrationAccessKey(input: {
	plan: CompanyPlan;
	stlLimit?: number | null;
	label?: string;
	createdForEmail?: string;
	notes?: string;
	expiresAt?: Date | null;
	issuedById?: string | null;
}) {
	const code = generateCode();
	const prismaAny = prisma as unknown as {
		registrationAccessKey: {
			create: (args: { data: Record<string, unknown> }) => Promise<{
				id: string;
				code: string;
				plan: CompanyPlan;
				stlLimit: number;
				label: string | null;
				expiresAt: Date | null;
			}>;
		};
	};

	return prismaAny.registrationAccessKey.create({
		data: {
			code,
			plan: input.plan,
			stlLimit: normalizeStlLimit(input.plan, input.stlLimit),
			label: input.label?.trim() || null,
			createdForEmail: input.createdForEmail?.trim().toLowerCase() || null,
			notes: input.notes?.trim() || null,
			expiresAt: normalizeAccessKeyExpiry(input.expiresAt),
			issuedById: input.issuedById ?? null,
		},
	});
}

export async function validateRegistrationAccessKey(code: string, email?: string | null) {
	const prismaAny = prisma as unknown as {
		registrationAccessKey: {
			findUnique: (args: { where: { code: string } }) => Promise<{
				id: string;
				code: string;
				status: AccessKeyStatus;
				plan: CompanyPlan;
				stlLimit: number;
				label: string | null;
				createdForEmail: string | null;
				expiresAt: Date | null;
			} | null>;
		};
	};

	const key = await prismaAny.registrationAccessKey.findUnique({
		where: { code: code.trim().toUpperCase() },
	});

	if (!key) {
		throw new Error('Ongeldige toegangssleutel');
	}
	if (key.status !== 'ACTIVE') {
		throw new Error('Deze toegangssleutel is niet meer actief');
	}
	if (isAccessKeyExpired(key.expiresAt)) {
		throw new Error('Deze toegangssleutel is verlopen');
	}
	if (key.createdForEmail && email && key.createdForEmail !== email.toLowerCase()) {
		throw new Error('Deze toegangssleutel hoort bij een ander e-mailadres');
	}

	return key;
}

export async function redeemRegistrationAccessKey(input: {
	code: string;
	organizationId: string;
	userId: string;
}) {
	const key = await validateRegistrationAccessKey(input.code);
	const prismaAny = prisma as unknown as {
		registrationAccessKey: {
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
		};
		organization: {
			update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
		};
	};

	const now = new Date();

	await prismaAny.registrationAccessKey.update({
		where: { id: key.id },
		data: {
			status: 'REDEEMED',
			redeemedAt: now,
			redeemedById: input.userId,
			issuedToOrgId: input.organizationId,
		},
	});

	// Set contract start date on the organization (yearly contract begins now)
	await prismaAny.organization.update({
		where: { id: input.organizationId },
		data: { contractStartDate: now },
	});

	return key;
}

export async function listRegistrationAccessKeys() {
	const prismaAny = prisma as unknown as {
		registrationAccessKey: {
			findMany: (args: Record<string, unknown>) => Promise<Array<{
				id: string;
				code: string;
				label: string | null;
				plan: CompanyPlan;
				stlLimit: number;
				status: AccessKeyStatus;
				createdForEmail: string | null;
				expiresAt: Date | null;
				redeemedAt: Date | null;
				notes: string | null;
				createdAt: Date;
				organization: { id: string; name: string; slug: string } | null;
				issuedBy: { id: string; name: string; email: string } | null;
				redeemedBy: { id: string; name: string; email: string } | null;
			}>>;
		};
	};

	return prismaAny.registrationAccessKey.findMany({
		orderBy: { createdAt: 'desc' },
		include: {
			organization: { select: { id: true, name: true, slug: true } },
			issuedBy: { select: { id: true, name: true, email: true } },
			redeemedBy: { select: { id: true, name: true, email: true } },
		},
	});
}

export async function deleteRegistrationAccessKey(keyId: string) {
	const prismaAny = prisma as unknown as {
		registrationAccessKey: {
			delete: (args: { where: { id: string } }) => Promise<unknown>;
		};
	};

	return prismaAny.registrationAccessKey.delete({
		where: { id: keyId },
	});
}
