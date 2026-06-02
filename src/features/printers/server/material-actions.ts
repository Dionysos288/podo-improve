'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import {
	DEFAULT_MATERIAL_NAME,
	DEFAULT_MATERIAL_SEEDS,
	SEEDED_MATERIAL_NAMES,
} from '../constants/default-materials';
import type { FilamentType } from '../constants/print-options';
import type { PrintMaterialItem } from '../types/printers';

export async function ensureDefaultPrintMaterials(
	orgId: string,
	printerId?: string
): Promise<void> {
	const count = await prisma.printMaterial.count({ where: { orgId } });
	if (count === 0) {
		await prisma.printMaterial.createMany({
			data: DEFAULT_MATERIAL_SEEDS.map((seed) => ({
				orgId,
				name: seed.name,
				filamentType: seed.filamentType,
				isCustomSlot: seed.isCustomSlot,
				nozzleTempC: seed.nozzleTempC,
				bedTempC: seed.bedTempC,
				maxSpeedMmS: seed.maxSpeedMmS,
				sortOrder: seed.sortOrder,
			})),
		});
	} else {
		// Self-heal: backfill print params on seeded materials created before
		// these columns existed (only when still empty, never overwrite edits).
		for (const seed of DEFAULT_MATERIAL_SEEDS) {
			if (seed.isCustomSlot || seed.nozzleTempC == null) continue;
			await prisma.printMaterial.updateMany({
				where: { orgId, name: seed.name, nozzleTempC: null },
				data: {
					nozzleTempC: seed.nozzleTempC,
					bedTempC: seed.bedTempC,
					maxSpeedMmS: seed.maxSpeedMmS,
				},
			});
		}
	}

	const printers =
		printerId != null
			? await prisma.printer.findMany({ where: { id: printerId, orgId }, select: { id: true } })
			: await prisma.printer.findMany({ where: { orgId }, select: { id: true } });

	if (printers.length === 0) return;

	const materials = await prisma.printMaterial.findMany({
		where: { orgId },
		orderBy: { sortOrder: 'asc' },
	});

	const defaultMaterial =
		materials.find((m) => m.name === DEFAULT_MATERIAL_NAME) ?? materials[0];
	if (!defaultMaterial) return;

	for (const printer of printers) {
		const linkCount = await prisma.printerMaterial.count({
			where: { printerId: printer.id },
		});
		if (linkCount > 0) continue;

		await prisma.printerMaterial.createMany({
			data: materials.map((m) => ({
				printerId: printer.id,
				materialId: m.id,
				isDefault: m.id === defaultMaterial.id,
			})),
		});
	}
}

export async function getOrgMaterials(): Promise<PrintMaterialItem[]> {
	const { orgId } = await requireOrganization();
	await ensureDefaultPrintMaterials(orgId);

	const materials = await prisma.printMaterial.findMany({
		where: { orgId },
		orderBy: { sortOrder: 'asc' },
		select: {
			id: true,
			orgId: true,
			name: true,
			filamentType: true,
			isCustomSlot: true,
			nozzleTempC: true,
			bedTempC: true,
			maxSpeedMmS: true,
			sortOrder: true,
		},
	});

	return materials;
}

function clampInt(value: number | null | undefined, min: number, max: number): number | null {
	if (value == null || Number.isNaN(value)) return null;
	return Math.min(max, Math.max(min, Math.round(value)));
}

export async function createMaterial(params: {
	name: string;
	filamentType: FilamentType;
	nozzleTempC?: number | null;
	bedTempC?: number | null;
	maxSpeedMmS?: number | null;
}): Promise<PrintMaterialItem> {
	const { orgId } = await requireOrganization();
	const name = params.name.trim();
	if (!name) throw new Error('Materiaalnaam is verplicht');

	const existing = await prisma.printMaterial.findFirst({
		where: { orgId, name },
	});
	if (existing) throw new Error('Dit materiaal bestaat al');

	const maxOrder = await prisma.printMaterial.aggregate({
		where: { orgId },
		_max: { sortOrder: true },
	});

	const created = await prisma.printMaterial.create({
		data: {
			orgId,
			name,
			filamentType: params.filamentType,
			isCustomSlot: false,
			nozzleTempC: clampInt(params.nozzleTempC, 150, 320),
			bedTempC: clampInt(params.bedTempC, 0, 120),
			maxSpeedMmS: clampInt(params.maxSpeedMmS, 5, 400),
			sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
		},
		select: {
			id: true,
			orgId: true,
			name: true,
			filamentType: true,
			isCustomSlot: true,
			nozzleTempC: true,
			bedTempC: true,
			maxSpeedMmS: true,
			sortOrder: true,
		},
	});

	const printers = await prisma.printer.findMany({
		where: { orgId },
		select: { id: true },
	});
	if (printers.length > 0) {
		await prisma.printerMaterial.createMany({
			data: printers.map((p) => ({
				printerId: p.id,
				materialId: created.id,
				isDefault: false,
			})),
			skipDuplicates: true,
		});
	}

	return created;
}

export async function updateMaterial(params: {
	materialId: string;
	nozzleTempC?: number | null;
	bedTempC?: number | null;
	maxSpeedMmS?: number | null;
	filamentType?: FilamentType;
}): Promise<PrintMaterialItem> {
	const { orgId } = await requireOrganization();
	const material = await prisma.printMaterial.findFirst({
		where: { id: params.materialId, orgId },
	});
	if (!material) throw new Error('Materiaal niet gevonden');

	const updated = await prisma.printMaterial.update({
		where: { id: params.materialId },
		data: {
			...(params.filamentType ? { filamentType: params.filamentType } : {}),
			nozzleTempC: clampInt(params.nozzleTempC, 150, 320),
			bedTempC: clampInt(params.bedTempC, 0, 120),
			maxSpeedMmS: clampInt(params.maxSpeedMmS, 5, 400),
		},
		select: {
			id: true,
			orgId: true,
			name: true,
			filamentType: true,
			isCustomSlot: true,
			nozzleTempC: true,
			bedTempC: true,
			maxSpeedMmS: true,
			sortOrder: true,
		},
	});

	return updated;
}

/**
 * Create or update a user-defined custom material from the design flow and make
 * sure it is assigned (non-default) to the given printer. Returns the material.
 */
export async function upsertCustomMaterial(params: {
	printerId: string;
	materialId?: string | null;
	name: string;
	filamentType: FilamentType;
	nozzleTempC?: number | null;
	bedTempC?: number | null;
	maxSpeedMmS?: number | null;
}): Promise<PrintMaterialItem> {
	const { orgId } = await requireOrganization();
	const name = params.name.trim();
	if (!name) throw new Error('Materiaalnaam is verplicht');

	const printer = await prisma.printer.findFirst({
		where: { id: params.printerId, orgId },
		select: { id: true },
	});
	if (!printer) throw new Error('Printer niet gevonden');

	const duplicate = await prisma.printMaterial.findFirst({
		where: { orgId, name, ...(params.materialId ? { id: { not: params.materialId } } : {}) },
	});
	if (duplicate) throw new Error('Er bestaat al een materiaal met deze naam');

	const data = {
		name,
		filamentType: params.filamentType,
		nozzleTempC: clampInt(params.nozzleTempC, 150, 320),
		bedTempC: clampInt(params.bedTempC, 0, 120),
		maxSpeedMmS: clampInt(params.maxSpeedMmS, 5, 400),
	};

	const select = {
		id: true,
		orgId: true,
		name: true,
		filamentType: true,
		isCustomSlot: true,
		nozzleTempC: true,
		bedTempC: true,
		maxSpeedMmS: true,
		sortOrder: true,
	} as const;

	if (params.materialId) {
		const existing = await prisma.printMaterial.findFirst({
			where: { id: params.materialId, orgId },
		});
		if (!existing) throw new Error('Materiaal niet gevonden');
		if (existing.isCustomSlot || SEEDED_MATERIAL_NAMES.includes(existing.name)) {
			throw new Error('Dit materiaal kan niet worden bewerkt');
		}
		return prisma.printMaterial.update({ where: { id: params.materialId }, data, select });
	}

	const maxOrder = await prisma.printMaterial.aggregate({
		where: { orgId },
		_max: { sortOrder: true },
	});
	const created = await prisma.printMaterial.create({
		data: { orgId, isCustomSlot: false, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1, ...data },
		select,
	});

	await prisma.printerMaterial.createMany({
		data: [{ printerId: params.printerId, materialId: created.id, isDefault: false }],
		skipDuplicates: true,
	});

	return created;
}

export async function deleteMaterial(materialId: string): Promise<void> {
	const { orgId } = await requireOrganization();
	const material = await prisma.printMaterial.findFirst({
		where: { id: materialId, orgId },
	});
	if (!material) throw new Error('Materiaal niet gevonden');
	if (material.isCustomSlot) {
		throw new Error('Het Custom-materiaal kan niet worden verwijderd');
	}

	const isSeeded = SEEDED_MATERIAL_NAMES.includes(material.name);
	if (isSeeded) {
		throw new Error('Standaardmaterialen kunnen niet worden verwijderd');
	}

	const defaultLinks = await prisma.printerMaterial.count({
		where: { materialId, isDefault: true },
	});
	if (defaultLinks > 0) {
		throw new Error(
			'Dit materiaal is ingesteld als standaard op een printer. Kies eerst een ander standaardmateriaal.'
		);
	}

	await prisma.printMaterial.delete({ where: { id: materialId } });
}

export async function setPrinterMaterials(params: {
	printerId: string;
	materialIds: string[];
	defaultMaterialId: string;
}): Promise<void> {
	const { orgId } = await requireOrganization();
	const printer = await prisma.printer.findFirst({
		where: { id: params.printerId, orgId },
	});
	if (!printer) throw new Error('Printer niet gevonden');

	if (params.materialIds.length === 0) {
		throw new Error('Selecteer minimaal één materiaal');
	}
	if (!params.materialIds.includes(params.defaultMaterialId)) {
		throw new Error('Standaardmateriaal moet geselecteerd zijn');
	}

	const validCount = await prisma.printMaterial.count({
		where: { orgId, id: { in: params.materialIds } },
	});
	if (validCount !== params.materialIds.length) {
		throw new Error('Ongeldige materialen geselecteerd');
	}

	await prisma.$transaction([
		prisma.printerMaterial.deleteMany({ where: { printerId: params.printerId } }),
		prisma.printerMaterial.createMany({
			data: params.materialIds.map((materialId) => ({
				printerId: params.printerId,
				materialId,
				isDefault: materialId === params.defaultMaterialId,
			})),
		}),
	]);
}
