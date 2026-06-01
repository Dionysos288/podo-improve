import { getOrgSettings } from '@/src/features/settings/server/actions';

export const orgSettingsQueryKey = ['settings', 'org'] as const;

export function orgSettingsQueryOptions() {
	return {
		queryKey: orgSettingsQueryKey,
		queryFn: () => getOrgSettings(),
	};
}
