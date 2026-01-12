'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import fs from 'fs/promises';
import path from 'path';

export type BackupListItem = {
	id: string;
	type: string | null;
	url: string | null;
	createdAt: Date;
};

function backupsDir() {
	// Persist on self-hosted/desktop installs. (Not suitable for serverless.)
	return path.join(process.cwd(), 'backups');
}

async function writeBackupFile(params: {
	orgId: string;
	backupId: string;
	payload: unknown;
}) {
	const dir = path.join(backupsDir(), params.orgId);
	await fs.mkdir(dir, { recursive: true });
	const filePath = path.join(dir, `${params.backupId}.json`);
	await fs.writeFile(filePath, JSON.stringify(params.payload, null, 2), 'utf8');
	return filePath;
}

export async function getBackups(): Promise<BackupListItem[]> {
	const { orgId } = await requireOrganization();
	const backups = await prisma.backup.findMany({
		where: { orgId },
		orderBy: { createdAt: 'desc' },
		select: { id: true, type: true, url: true, createdAt: true },
	});
	return backups;
}

export async function createBackup(): Promise<BackupListItem> {
	const { orgId, session } = await requireOrganization();

	// Create DB record first so we have an ID for filename + download URL
	const created = await prisma.backup.create({
		data: { orgId, type: 'json', url: null },
		select: { id: true, type: true, url: true, createdAt: true },
	});

	// Snapshot data (keep it simple + deterministic; can evolve to zip later)
	const [org, printers, patients, projects] = await Promise.all([
		prisma.organization.findUnique({
			where: { id: orgId },
			select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true, settings: true },
		}),
		prisma.printer.findMany({
			where: { orgId },
			select: { id: true, name: true, brand: true, model: true, settings: true, createdAt: true, updatedAt: true },
		}),
		prisma.patient.findMany({
			where: { orgId, deletedAt: null },
			select: { id: true, firstName: true, lastName: true, birthDate: true, notes: true, createdAt: true, updatedAt: true },
			orderBy: { createdAt: 'asc' },
		}),
		prisma.project.findMany({
			where: { patient: { orgId }, deletedAt: null },
			select: {
				id: true,
				patientId: true,
				doctorId: true,
				name: true,
				date: true,
				status: true,
				createdAt: true,
				updatedAt: true,
				scans: {
					select: {
						id: true,
						projectId: true,
						footSide: true,
						stlUrl: true,
						uploadedBy: true,
						metadata: true,
						createdAt: true,
					},
				},
				designs: {
					select: {
						id: true,
						projectId: true,
						parameters: true,
						elements: true,
						matchTransform: true,
						stlUrl: true,
						gcodeUrl: true,
						version: true,
						parentDesignId: true,
						createdAt: true,
						updatedAt: true,
					},
				},
			},
			orderBy: { createdAt: 'asc' },
		}),
	]);

	const payload = {
		meta: {
			version: 1,
			createdAt: created.createdAt.toISOString(),
			createdByUserId: session.user.id,
		},
		organization: org,
		printers,
		patients,
		projects,
	};

	await writeBackupFile({ orgId, backupId: created.id, payload });

	const url = `/api/backups/${created.id}/download`;
	const updated = await prisma.backup.update({
		where: { id: created.id },
		data: { url },
		select: { id: true, type: true, url: true, createdAt: true },
	});

	return updated;
}

export async function deleteBackup(backupId: string): Promise<void> {
	const { orgId } = await requireOrganization();

	const backup = await prisma.backup.findFirst({
		where: { id: backupId, orgId },
		select: { id: true },
	});
	if (!backup) {
		throw new Error('Backup niet gevonden');
	}

	const filePath = path.join(backupsDir(), orgId, `${backup.id}.json`);
	await fs.rm(filePath, { force: true });

	await prisma.backup.delete({ where: { id: backup.id } });
}

