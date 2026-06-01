import { getInvitations } from '@/src/features/invitations/server/actions';

export const invitationsQueryKey = ['invitations'] as const;

export function invitationsQueryOptions() {
	return {
		queryKey: invitationsQueryKey,
		queryFn: () => getInvitations(),
	};
}
