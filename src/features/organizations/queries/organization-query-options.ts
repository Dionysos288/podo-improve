import { getOrganizationMembers } from '@/src/features/organizations/server/actions';

export const organizationMembersQueryKey = ['organization', 'members'] as const;

export function organizationMembersQueryOptions() {
	return {
		queryKey: organizationMembersQueryKey,
		queryFn: () => getOrganizationMembers(),
	};
}
