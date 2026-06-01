'use server';

import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import type { PrinterListItem, PrinterSettings } from '../types/printers';

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

function defaultPrinterSettings(): PrinterSettings {
	return {
		nozzleDiameter: 0.8,
		strategy: 'Default',
		extruder: 'Links',
		retraction: 0,
		printerModel: 'E2',
		overhang: 1,
		underlay: 2,
		perPart: false,
		adhesion: 'Geen',
		infill: 'Standard',
		hardnessProfiles: {
			extraSoft: { infillPercent: 10 },
			soft: { infillPercent: 22 },
			normal: { infillPercent: 26 },
			hard: { infillPercent: 30 },
			extraHard: { infillPercent: 36 },
		},
	};
}

export async function ensureDefaultPrinter(): Promise<void> {
	const { orgId } = await requireOrganization();
	const count = await prisma.printer.count({ where: { orgId } });
	if (count > 0) return;

	await prisma.printer.create({
		data: {
			orgId,
			name: 'Raise3D E2',
			brand: 'Raise3D',
			model: 'E2',
			settings: defaultPrinterSettings(),
		},
	});
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
		settings: (p.settings as PrinterSettings) ?? {},
	}));
}

export async function getPrintersWithDefault(): Promise<PrinterListItem[]> {
	const { orgId } = await requireOrganization();
	const printers = await prisma.printer.findMany({
		where: { orgId },
		orderBy: { createdAt: 'asc' },
		select: printerListSelect,
	});

	if (printers.length > 0) {
		return printers.map((p) => ({
			...p,
			settings: (p.settings as PrinterSettings) ?? {},
		}));
	}

	const created = await prisma.printer.create({
		data: {
			orgId,
			name: 'Raise3D E2',
			brand: 'Raise3D',
			model: 'E2',
			settings: defaultPrinterSettings(),
		},
		select: printerListSelect,
	});

	return [
		{
			...created,
			settings: (created.settings as PrinterSettings) ?? {},
		},
	];
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

	const merged = { ...asObject(existing.settings), ...params.patch };
	await prisma.printer.update({
		where: { id: params.printerId },
		data: { settings: merged },
	});
}

