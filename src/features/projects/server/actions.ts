'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireSession, requireOrganization } from '@/src/shared/core/auth/get-session';
import { revalidatePath } from 'next/cache';

export interface CreateProjectData {
	patientId: string;
	name: string;
	date?: Date | string;
	doctorId?: string;
}

export interface UpdateProjectData {
	name?: string;
	status?: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';
	date?: Date | string;
	doctorId?: string;
}

export async function getProjects(filters?: {
	status?: string;
	patientId?: string;
}) {
	const { orgId } = await requireOrganization();

	const projects = await prisma.project.findMany({
		where: {
			patient: { orgId },
			deletedAt: null,
			...(filters?.status && { status: filters.status as any }),
			...(filters?.patientId && { patientId: filters.patientId }),
		},
		include: {
			patient: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
				},
			},
			doctor: {
				select: {
					id: true,
					name: true,
				},
			},
			_count: {
				select: {
					scans: true,
					designs: true,
				},
			},
		},
		orderBy: { createdAt: 'desc' },
	});

	return projects.map((project) => ({
		id: project.id,
		name: project.name,
		date: project.date,
		status: project.status,
		createdAt: project.createdAt,
		patient: project.patient,
		doctor: project.doctor,
		scansCount: project._count.scans,
		designsCount: project._count.designs,
	}));
}

export async function getProject(id: string) {
	const { orgId } = await requireOrganization();

	const project = await prisma.project.findFirst({
		where: {
			id,
			patient: { orgId },
			deletedAt: null,
		},
		include: {
			patient: true,
			doctor: {
				select: {
					id: true,
					name: true,
					email: true,
				},
			},
			scans: {
				orderBy: { createdAt: 'desc' },
			},
			designs: {
				where: { deletedAt: null },
				orderBy: { version: 'desc' },
			},
		},
	});

	if (!project) {
		throw new Error('Project niet gevonden');
	}

	return project;
}

export async function createProject(data: CreateProjectData) {
	const session = await requireSession();
	const { orgId } = await requireOrganization();

	// Verify patient belongs to this org
	const patient = await prisma.patient.findFirst({
		where: {
			id: data.patientId,
			orgId,
			deletedAt: null,
		},
	});

	if (!patient) {
		throw new Error('Patiënt niet gevonden');
	}

	// Verify doctor belongs to this org if provided
	let doctorId = data.doctorId || session.user.id;
	if (data.doctorId) {
		const doctor = await prisma.user.findFirst({
			where: {
				id: data.doctorId,
				orgId,
			},
		});
		if (!doctor) {
			throw new Error('Behandelaar niet gevonden');
		}
	}

	const project = await prisma.project.create({
		data: {
			patientId: data.patientId,
			doctorId,
			name: data.name,
			date: data.date ? new Date(data.date) : new Date(),
			status: 'DRAFT',
		},
	});

	revalidatePath('/[orgSlug]/projects');
	revalidatePath(`/[orgSlug]/patients/${data.patientId}`);

	return project;
}

export async function updateProject(id: string, data: UpdateProjectData) {
	const { orgId } = await requireOrganization();

	// Verify project belongs to this org
	const existing = await prisma.project.findFirst({
		where: {
			id,
			patient: { orgId },
			deletedAt: null,
		},
	});

	if (!existing) {
		throw new Error('Project niet gevonden');
	}

	// Verify doctor belongs to this org if provided
	let updateData: any = {
		name: data.name,
		status: data.status,
		date: data.date ? new Date(data.date as string) : undefined,
	};

	if (data.doctorId) {
		const doctor = await prisma.user.findFirst({
			where: {
				id: data.doctorId,
				orgId,
			},
		});
		if (!doctor) {
			throw new Error('Behandelaar niet gevonden');
		}
		updateData.doctorId = data.doctorId;
	}

	const project = await prisma.project.update({
		where: { id },
		data: updateData,
	});

	revalidatePath('/[orgSlug]/projects');
	revalidatePath(`/[orgSlug]/projects/${id}`);

	return project;
}

export async function deleteProject(id: string) {
	const { orgId } = await requireOrganization();

	// Verify project belongs to this org
	const existing = await prisma.project.findFirst({
		where: {
			id,
			patient: { orgId },
			deletedAt: null,
		},
	});

	if (!existing) {
		throw new Error('Project niet gevonden');
	}

	// Soft delete
	await prisma.project.update({
		where: { id },
		data: { deletedAt: new Date() },
	});

	revalidatePath('/[orgSlug]/projects');

	return { success: true };
}

export async function getProjectScans(projectId: string) {
	const { orgId } = await requireOrganization();

	// Verify project belongs to this org
	const project = await prisma.project.findFirst({
		where: {
			id: projectId,
			patient: { orgId },
			deletedAt: null,
		},
	});

	if (!project) {
		throw new Error('Project niet gevonden');
	}

	const scans = await prisma.scan.findMany({
		where: { projectId },
		orderBy: { createdAt: 'desc' },
	});

	return scans;
}
