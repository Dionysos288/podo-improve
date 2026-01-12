import { getBackups } from '@/src/features/backups/server/actions';
import { BackupsClient } from '@/src/features/backups/components/BackupsClient';

export default async function SettingsBackupPage() {
	const backups = await getBackups();
	return <BackupsClient backups={backups} />;
}

