import type { Metadata } from 'next';
import { MdrSettingsContent } from '@/src/features/settings/components/MdrSettingsContent';
import { orgSettingsQueryOptions } from '@/src/features/settings/queries/settings-query-options';
import { PrefetchedQueryBoundary } from '@/src/shared/core/query/PrefetchedQueryBoundary';

export const metadata: Metadata = {
	title: 'MDR & regelgeving',
	description:
		'Overzicht van MDR-verplichtingen voor maatwerk voetorthosen, Annex XIII-verklaringen en organisatiegegevens.',
};

export default function SettingsMdrPage() {
	return (
		<PrefetchedQueryBoundary queries={[orgSettingsQueryOptions()]}>
			<MdrSettingsContent />
		</PrefetchedQueryBoundary>
	);
}
