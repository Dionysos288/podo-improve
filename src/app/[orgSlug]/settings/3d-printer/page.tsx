import type { Metadata } from 'next';
import { getPrintersWithDefault } from '@/src/features/printers/server/actions';
import { PrintersClient } from '@/src/features/printers/components/PrintersClient';

export const metadata: Metadata = {
	title: '3D-printer',
	description: 'Configureer uw 3D-printerprofielen en afdrukinstellingen.',
};

export default async function Settings3DPrinterPage() {
	const printers = await getPrintersWithDefault();
	return <PrintersClient printers={printers} />;
}

