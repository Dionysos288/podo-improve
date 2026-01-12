'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import {
	requireSession,
	requireOrganization,
} from '@/src/shared/core/auth/get-session';
import { randomBytes } from 'crypto';
import { sendInvitationEmail } from '@/src/shared/core/email/send-invitation';

function generateInviteCode(): string {
	return randomBytes(4).toString('hex').toUpperCase();
}

import type { CreateInvitationData } from '../types/types';

export async function createInvitation(data: CreateInvitationData) {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Only admins can create invitations
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (user?.role !== 'ADMIN') {
		throw new Error('Alleen beheerders kunnen uitnodigingen versturen');
	}

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays || 7));

	const invitation = await prisma.invitation.create({
		data: {
			orgId,
			email: data.type === 'email' ? data.email : null,
			code: generateInviteCode(),
			role: data.role || 'DOCTOR',
			expiresAt,
			invitedById: session.user.id,
		},
		include: {
			organization: true,
			invitedBy: {
				select: { name: true },
			},
		},
	});

	if (data.type === 'email' && data.email) {
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
		const inviteUrl = `${appUrl}/join/${invitation.code}`;
		const expiresInDays = data.expiresInDays || 7;

		await sendInvitationEmail({
			to: data.email,
			inviteUrl,
			orgName: invitation.organization.name,
			inviterName: invitation.invitedBy.name,
			role: invitation.role,
			expiresInDays,
		});
	}

	return {
		id: invitation.id,
		code: invitation.code,
		email: invitation.email,
		role: invitation.role,
		expiresAt: invitation.expiresAt,
		orgName: invitation.organization.name,
	};
}

export async function getInvitations() {
	const { orgId } = await requireOrganization();

	const invitations = await prisma.invitation.findMany({
		where: {
			orgId,
			acceptedAt: null,
		},
		include: {
			invitedBy: {
				select: { name: true },
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	return invitations.map((inv) => ({
		id: inv.id,
		code: inv.code,
		email: inv.email,
		role: inv.role,
		expiresAt: inv.expiresAt,
		createdAt: inv.createdAt,
		invitedByName: inv.invitedBy.name,
		isExpired: new Date() > inv.expiresAt,
	}));
}

export async function revokeInvitation(invitationId: string) {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Only admins can revoke invitations
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (user?.role !== 'ADMIN') {
		throw new Error('Alleen beheerders kunnen uitnodigingen intrekken');
	}

	// Verify invitation belongs to this org
	const invitation = await prisma.invitation.findUnique({
		where: { id: invitationId },
	});

	if (!invitation || invitation.orgId !== orgId) {
		throw new Error('Uitnodiging niet gevonden');
	}

	await prisma.invitation.delete({
		where: { id: invitationId },
	});

	return { success: true };
}

export async function validateInvitation(code: string) {
	const invitation = await prisma.invitation.findUnique({
		where: { code },
		include: {
			organization: true,
		},
	});

	if (!invitation) {
		throw new Error('Ongeldige uitnodigingscode');
	}

	if (invitation.acceptedAt) {
		throw new Error('Deze uitnodiging is al gebruikt');
	}

	if (new Date() > invitation.expiresAt) {
		throw new Error('Deze uitnodiging is verlopen');
	}

	return {
		orgName: invitation.organization.name,
		email: invitation.email,
		role: invitation.role,
	};
}

export async function acceptInvitation(code: string) {
	const session = await requireSession();

	const invitation = await prisma.invitation.findUnique({
		where: { code },
		include: {
			organization: true,
		},
	});

	if (!invitation) {
		throw new Error('Ongeldige uitnodigingscode');
	}

	if (invitation.acceptedAt) {
		throw new Error('Deze uitnodiging is al gebruikt');
	}

	if (new Date() > invitation.expiresAt) {
		throw new Error('Deze uitnodiging is verlopen');
	}

	// If invitation has an email, verify it matches the user's email
	if (invitation.email && invitation.email !== session.user.email) {
		throw new Error('Deze uitnodiging is voor een ander e-mailadres');
	}

	// Update invitation as accepted
	await prisma.invitation.update({
		where: { id: invitation.id },
		data: {
			acceptedAt: new Date(),
			acceptedById: session.user.id,
		},
	});

	// Add user to organization
	await prisma.user.update({
		where: { id: session.user.id },
		data: {
			orgId: invitation.orgId,
			role: invitation.role,
		},
	});

	return {
		orgSlug: invitation.organization.slug,
		orgName: invitation.organization.name,
	};
}
