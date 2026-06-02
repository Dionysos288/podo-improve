import type { Metadata } from 'next';
import { getPrintersWithMaterials } from '@/src/features/printers/server/actions';
import { getOrgMaterials } from '@/src/features/printers/server/material-actions';
import { PrintersClient } from '@/src/features/printers/components/PrintersClient';

export const metadata: Metadata = {
	title: '3D-printer',
	description: 'Configureer uw 3D-printerprofielen en afdrukinstellingen.',
};

export default async function Settings3DPrinterPage() {
	const [printers, materials] = await Promise.all([
		getPrintersWithMaterials(),
		getOrgMaterials(),
	]);
	return <PrintersClient printers={printers} materials={materials} />;
}
