import type { Metadata } from 'next';
import { AdminPanel } from '@/src/features/admin/components/AdminPanel';

export const metadata: Metadata = {
	title: 'Gebruikers',
	description: 'Beheer de gebruikers en teamleden van uw organisatie.',
};

export default function SettingsUsersPage() {
	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<AdminPanel />
		</div>
	);
}
