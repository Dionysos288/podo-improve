import type { Metadata } from 'next';
import { PlatformAdminDashboard } from '@/src/features/admin/components/PlatformAdminDashboard';
import { getPlatformDashboardData } from '@/src/features/admin/server/platform-actions';

export const metadata: Metadata = {
	title: 'Platformbeheer',
	description: 'Beheer alle organisaties, toegangssleutels en platforminstellingen.',
};

export default async function SettingsAdminPage() {
	const data = await getPlatformDashboardData();
	return <PlatformAdminDashboard data={data} />;
}
