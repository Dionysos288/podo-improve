import type { Metadata } from 'next';
import { AdminPanel } from '@/src/features/admin/components/AdminPanel';
import { invitationsQueryOptions } from '@/src/features/invitations/queries/invitation-query-options';
import { organizationMembersQueryOptions } from '@/src/features/organizations/queries/organization-query-options';
import { PrefetchedQueryBoundary } from '@/src/shared/core/query/PrefetchedQueryBoundary';

export const metadata: Metadata = {
	title: 'Gebruikers',
	description: 'Beheer de gebruikers en teamleden van uw organisatie.',
};

export default function SettingsUsersPage() {
	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<PrefetchedQueryBoundary
				queries={[
					organizationMembersQueryOptions(),
					invitationsQueryOptions(),
				]}
			>
				<AdminPanel />
			</PrefetchedQueryBoundary>
		</div>
	);
}
