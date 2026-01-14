'use server';

import { Prisma } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization, requireSession } from '@/src/shared/core/auth/get-session';
import type { OrgSettings } from '../types/settings.ts';

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	return value as Record<string, unknown>;
}

export async function getOrgSettings(): Promise<OrgSettings> {
	const { orgId } = await requireOrganization();
	const org = await prisma.organization.findUnique({
		where: { id: orgId },
		select: { settings: true },
	});
	return (org?.settings as OrgSettings) ?? {};
}

export async function updateOrgSettings(patch: OrgSettings): Promise<OrgSettings> {
	const { orgId } = await requireOrganization();
	const existing = await prisma.organization.findUnique({
		where: { id: orgId },
		select: { settings: true },
	});
	const merged = { ...asObject(existing?.settings), ...patch };
	const updated = await prisma.organization.update({
		where: { id: orgId },
		data: { settings: merged as Prisma.InputJsonValue },
		select: { settings: true },
	});
	return (updated.settings as OrgSettings) ?? {};
}

export async function getUserSettings(): Promise<Record<string, unknown>> {
	const session = await requireSession();
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { settings: true },
	});
	return (user?.settings as Record<string, unknown>) ?? {};
}

export async function updateUserSettings(
	patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const session = await requireSession();
	const existing = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { settings: true },
	});
	const merged = { ...asObject(existing?.settings), ...patch };
	const updated = await prisma.user.update({
		where: { id: session.user.id },
		data: { settings: merged as Prisma.InputJsonValue },
		select: { settings: true },
	});
	return (updated.settings as Record<string, unknown>) ?? {};
}

