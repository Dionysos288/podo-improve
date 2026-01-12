import { ensureDefaultPrinter, getPrinters } from '@/src/features/printers/server/actions';
import { PrintersClient } from '@/src/features/printers/components/PrintersClient';

export default async function Settings3DPrinterPage() {
	await ensureDefaultPrinter();
	const printers = await getPrinters();
	return <PrintersClient printers={printers} />;
}

