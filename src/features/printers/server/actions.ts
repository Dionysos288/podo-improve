'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import { normalizePrinterSettings } from '../constants/print-options';
import { ensureDefaultPrintMaterials } from './material-actions';
import type { PrinterListItem, PrinterSettings, PrinterWithMaterials } from '../types/printers';

const printerListSelect = {
	id: true,
	orgId: true,
	name: true,
	brand: true,
	model: true,
	settings: true,
	createdAt: true,
	updatedAt: true,
} as const;

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	return value as Record<string, unknown>;
}

const DEFAULT_HARDNESS_PROFILES = {
	extraSoft: { infillPercent: 10 },
	soft: { infillPercent: 22 },
	normal: { infillPercent: 26 },
	hard: { infillPercent: 30 },
	extraHard: { infillPercent: 36 },
};

function defaultE2Settings(): PrinterSettings {
	return {
		nozzleDiameter: 0.8,
		strategy: '0.20mm',
		extruder: 'Links',
		retraction: 0,
		printerModel: 'E2',
		overhang: 1,
		underlay: 2,
		perPart: false,
		adhesion: 'Geen',
		infill: 'gyroid',
		hardnessProfiles: DEFAULT_HARDNESS_PROFILES,
	};
}

function defaultIR3Settings(): PrinterSettings {
	return {
		nozzleDiameter: 0.4,
		strategy: '0.20mm',
		extruder: 'Links',
		retraction: 1,
		printerModel: 'IR3 V2',
		overhang: 3,
		underlay: 3,
		perPart: false,
		adhesion: 'Geen',
		infill: 'gyroid',
		hardnessProfiles: DEFAULT_HARDNESS_PROFILES,
	};
}

const DEFAULT_PRINTERS: Array<{
	name: string;
	brand: string;
	model: string;
	isIR3: boolean;
	settings: () => PrinterSettings;
}> = [
	{ name: 'Raise3D E2', brand: 'Raise3D', model: 'E2', isIR3: false, settings: defaultE2Settings },
	{
		name: 'IdeaFormer IR3 V2',
		brand: 'IdeaFormer',
		model: 'IR3 V2',
		isIR3: true,
		settings: defaultIR3Settings,
	},
];

/** Ensure both default printers (Raise3D E2 + IdeaFormer IR3 V2) exist for the org. */
export async function ensureDefaultPrinters(orgId: string): Promise<void> {
	const existing = await prisma.printer.findMany({
		where: { orgId },
		select: { id: true, model: true, name: true },
	});
	const hasIR3 = (s?: string | null) => /ir3|ideaformer/i.test(s ?? '');
	const ir3Present = existing.some((p) => hasIR3(p.model) || hasIR3(p.name));
	const e2Present = existing.some((p) => !hasIR3(p.model) && !hasIR3(p.name));

	const toCreate = DEFAULT_PRINTERS.filter((p) =>
		p.isIR3 ? !ir3Present : existing.length > 0 ? !e2Present : true
	);

	for (const p of toCreate) {
		const created = await prisma.printer.create({
			data: { orgId, name: p.name, brand: p.brand, model: p.model, settings: p.settings() },
			select: { id: true },
		});
		await ensureDefaultPrintMaterials(orgId, created.id);
	}
}

export async function ensureDefaultPrinter(): Promise<void> {
	const { orgId } = await requireOrganization();
	await ensureDefaultPrinters(orgId);
	await ensureDefaultPrintMaterials(orgId);
}

export async function getPrinters(): Promise<PrinterListItem[]> {
	const { orgId } = await requireOrganization();
	const printers = await prisma.printer.findMany({
		where: { orgId },
		orderBy: { createdAt: 'asc' },
		select: printerListSelect,
	});

	return printers.map((p) => ({
		...p,
		settings: normalizePrinterSettings((p.settings as PrinterSettings) ?? {}),
	}));
}

function mapPrinterMaterials(
	printerMaterials: Array<{
		isDefault: boolean;
		material: {
			id: string;
			name: string;
			filamentType: string;
			isCustomSlot: boolean;
			nozzleTempC: number | null;
			bedTempC: number | null;
			maxSpeedMmS: number | null;
		};
	}>
) {
	return printerMaterials.map((pm) => ({
		materialId: pm.material.id,
		name: pm.material.name,
		filamentType: pm.material.filamentType,
		isCustomSlot: pm.material.isCustomSlot,
		nozzleTempC: pm.material.nozzleTempC,
		bedTempC: pm.material.bedTempC,
		maxSpeedMmS: pm.material.maxSpeedMmS,
		isDefault: pm.isDefault,
	}));
}

export async function getPrintersWithDefault(): Promise<PrinterListItem[]> {
	const { orgId } = await requireOrganization();
	await ensureDefaultPrinters(orgId);
	await ensureDefaultPrintMaterials(orgId);

	const printers = await prisma.printer.findMany({
		where: { orgId },
		orderBy: { createdAt: 'asc' },
		select: printerListSelect,
	});

	return printers.map((p) => ({
		...p,
		settings: normalizePrinterSettings((p.settings as PrinterSettings) ?? {}),
	}));
}

const materialLinkSelect = {
	orderBy: { material: { sortOrder: 'asc' } },
	select: {
		isDefault: true,
		material: {
			select: {
				id: true,
				name: true,
				filamentType: true,
				isCustomSlot: true,
				nozzleTempC: true,
				bedTempC: true,
				maxSpeedMmS: true,
			},
		},
	},
} as const;

export async function getPrintersWithMaterials(): Promise<PrinterWithMaterials[]> {
	const { orgId } = await requireOrganization();
	await ensureDefaultPrinters(orgId);
	await ensureDefaultPrintMaterials(orgId);

	const printers = await prisma.printer.findMany({
		where: { orgId },
		orderBy: { createdAt: 'asc' },
		select: {
			...printerListSelect,
			printerMaterials: materialLinkSelect,
		},
	});

	return printers.map((p) => ({
		...p,
		settings: normalizePrinterSettings((p.settings as PrinterSettings) ?? {}),
		materials: mapPrinterMaterials(p.printerMaterials),
	}));
}

export async function updatePrinterSettings(params: {
	printerId: string;
	patch: PrinterSettings;
}): Promise<void> {
	const { orgId } = await requireOrganization();
	const existing = await prisma.printer.findFirst({
		where: { id: params.printerId, orgId },
		select: { settings: true },
	});
	if (!existing) throw new Error('Printer niet gevonden');

	const merged = normalizePrinterSettings({
		...asObject(existing.settings),
		...params.patch,
	} as PrinterSettings);
	await prisma.printer.update({
		where: { id: params.printerId },
		data: { settings: merged },
	});
}

