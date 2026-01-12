'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	getOrgSettings,
	getUserSettings,
	updateOrgSettings,
	updateUserSettings,
} from '../server/actions';
import type { OrgSettings } from '../types/settings';

export function useOrgSettings() {
	return useQuery({
		queryKey: ['settings', 'org'],
		queryFn: () => getOrgSettings(),
	});
}

export function useUserSettings() {
	return useQuery({
		queryKey: ['settings', 'user'],
		queryFn: () => getUserSettings(),
	});
}

export function useUpdateOrgSettings() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: OrgSettings) => updateOrgSettings(patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['settings', 'org'] });
		},
	});
}

export function useUpdateUserSettings() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: Record<string, unknown>) => updateUserSettings(patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['settings', 'user'] });
		},
	});
}

