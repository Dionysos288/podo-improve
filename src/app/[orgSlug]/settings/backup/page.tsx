import type { Metadata } from 'next';
import { getBackups } from '@/src/features/backups/server/actions';
import { BackupsClient } from '@/src/features/backups/components/BackupsClient';

export const metadata: Metadata = {
	title: 'Backup & Migratie',
	description: 'Maak en beheer back-ups van uw organisatiegegevens.',
};

export default async function SettingsBackupPage() {
	const backups = await getBackups();
	return <BackupsClient backups={backups} />;
}

