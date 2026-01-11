'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import { revalidatePath } from 'next/cache';

export interface CreatePatientData {
	firstName: string;
	lastName: string;
	birthDate?: Date | string;
	notes?: string;
}

export interface UpdatePatientData {
	firstName?: string;
	lastName?: string;
	birthDate?: Date | string | null;
	notes?: string | null;
}

export async function getPatients() {
	const { orgId } = await requireOrganization();

	const patients = await prisma.patient.findMany({
		where: {
			orgId,
			deletedAt: null,
		},
		include: {
			_count: {
				select: { projects: true },
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	return patients.map((patient: (typeof patients)[number]) => ({
		id: patient.id,
		firstName: patient.firstName,
		lastName: patient.lastName,
		birthDate: patient.birthDate,
		notes: patient.notes,
		createdAt: patient.createdAt,
		projectsCount: patient._count.projects,
	}));
}

export async function getPatient(id: string) {
	const { orgId } = await requireOrganization();

	const patient = await prisma.patient.findFirst({
		where: {
			id,
			orgId,
			deletedAt: null,
		},
		include: {
			projects: {
				where: { deletedAt: null },
				include: {
					doctor: {
						select: { name: true },
					},
				},
				orderBy: { createdAt: 'desc' },
			},
		},
	});

	if (!patient) {
		throw new Error('Patiënt niet gevonden');
	}

	return patient;
}

export async function createPatient(data: CreatePatientData) {
	const { orgId } = await requireOrganization();

	const patient = await prisma.patient.create({
		data: {
			orgId,
			firstName: data.firstName,
			lastName: data.lastName,
			birthDate: data.birthDate ? new Date(data.birthDate) : null,
			notes: data.notes || null,
		},
	});

	revalidatePath('/[orgSlug]/patients');

	return patient;
}

export async function updatePatient(id: string, data: UpdatePatientData) {
	const { orgId } = await requireOrganization();

	// Verify patient belongs to this org
	const existing = await prisma.patient.findFirst({
		where: { id, orgId, deletedAt: null },
	});

	if (!existing) {
		throw new Error('Patiënt niet gevonden');
	}

	const patient = await prisma.patient.update({
		where: { id },
		data: {
			firstName: data.firstName,
			lastName: data.lastName,
			birthDate: data.birthDate
				? new Date(data.birthDate as string)
				: data.birthDate === null
				? null
				: undefined,
			notes: data.notes,
		},
	});

	revalidatePath('/[orgSlug]/patients');
	revalidatePath(`/[orgSlug]/patients/${id}`);

	return patient;
}

export async function deletePatient(id: string) {
	const { orgId } = await requireOrganization();

	// Verify patient belongs to this org
	const existing = await prisma.patient.findFirst({
		where: { id, orgId, deletedAt: null },
	});

	if (!existing) {
		throw new Error('Patiënt niet gevonden');
	}

	// Soft delete
	await prisma.patient.update({
		where: { id },
		data: { deletedAt: new Date() },
	});

	revalidatePath('/[orgSlug]/patients');

	return { success: true };
}
