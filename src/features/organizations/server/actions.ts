'use server';

import { CompanyPlan } from '@prisma/client';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireSession, requireOrganization } from '@/src/shared/core/auth/get-session';
import {
	redeemRegistrationAccessKey,
	validateRegistrationAccessKey,
} from '@/src/shared/core/platform/access-keys';
import { normalizeStlLimit } from '@/src/shared/core/platform/plans';

export async function createOrganization(data: {
	name: string;
	slug: string;
	accessKey: string;
}) {
	const session = await requireSession();

	// Validate slug format
	const slugRegex = /^[a-z0-9-]+$/;
	if (!slugRegex.test(data.slug)) {
		throw new Error('Ongeldige URL: gebruik alleen kleine letters, cijfers en streepjes');
	}

	if (data.slug.length < 3) {
		throw new Error('URL moet minimaal 3 tekens bevatten');
	}

	if (!data.accessKey?.trim()) {
		throw new Error('Toegangssleutel is verplicht');
	}

	const accessKey = await validateRegistrationAccessKey(
		data.accessKey,
		session.user.email
	);

	// Check if slug is already taken
	const existing = await prisma.organization.findUnique({
		where: { slug: data.slug },
	});

	if (existing) {
		throw new Error('Deze URL is al in gebruik');
	}

	// Create organization and update user
	const organization = await prisma.organization.create({
		data: {
			name: data.name,
			slug: data.slug,
			plan: accessKey.plan,
			stlLimit: normalizeStlLimit(accessKey.plan as CompanyPlan, accessKey.stlLimit),
			billingStatus: 'offline-approved',
			users: {
				connect: { id: session.user.id },
			},
		},
	});

	// Update user role to ADMIN for org creator
	await prisma.user.update({
		where: { id: session.user.id },
		data: {
			orgId: organization.id,
			role: 'ADMIN',
		},
	});

	await redeemRegistrationAccessKey({
		code: accessKey.code,
		organizationId: organization.id,
		userId: session.user.id,
	});

	return organization;
}

export async function getOrganization() {
	const { orgId } = await requireOrganization();

	const organization = await prisma.organization.findUnique({
		where: { id: orgId },
		include: {
			_count: {
				select: {
					users: true,
					patients: true,
				},
			},
		},
	});

	return organization;
}

export async function updateOrganization(data: { name?: string }) {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Only admins can update organization
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (user?.role !== 'ADMIN') {
		throw new Error('Alleen beheerders kunnen de organisatie wijzigen');
	}

	const organization = await prisma.organization.update({
		where: { id: orgId },
		data: {
			name: data.name,
		},
	});

	return organization;
}

export async function getOrganizationMembers() {
	const { orgId } = await requireOrganization();

	const members = await prisma.user.findMany({
		where: { orgId },
		select: {
			id: true,
			name: true,
			email: true,
			role: true,
			createdAt: true,
		},
		orderBy: { createdAt: 'asc' },
	});

	return members;
}

export async function updateMemberRole(userId: string, role: 'ADMIN' | 'DOCTOR') {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Only admins can change roles
	const currentUser = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (currentUser?.role !== 'ADMIN') {
		throw new Error('Alleen beheerders kunnen rollen wijzigen');
	}

	// Can't change your own role
	if (userId === session.user.id) {
		throw new Error('Je kunt je eigen rol niet wijzigen');
	}

	// Verify target user is in the same org
	const targetUser = await prisma.user.findUnique({
		where: { id: userId },
	});

	if (targetUser?.orgId !== orgId) {
		throw new Error('Gebruiker niet gevonden');
	}

	const updatedUser = await prisma.user.update({
		where: { id: userId },
		data: { role },
	});

	return updatedUser;
}

export async function removeMember(userId: string) {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Only admins can remove members
	const currentUser = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (currentUser?.role !== 'ADMIN') {
		throw new Error('Alleen beheerders kunnen leden verwijderen');
	}

	// Can't remove yourself
	if (userId === session.user.id) {
		throw new Error('Je kunt jezelf niet verwijderen');
	}

	// Verify target user is in the same org
	const targetUser = await prisma.user.findUnique({
		where: { id: userId },
	});

	if (targetUser?.orgId !== orgId) {
		throw new Error('Gebruiker niet gevonden');
	}

	// Remove user from organization (set orgId to null)
	await prisma.user.update({
		where: { id: userId },
		data: { orgId: null },
	});

	return { success: true };
}
