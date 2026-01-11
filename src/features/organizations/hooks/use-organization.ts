'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getOrganization,
	updateOrganization,
	getOrganizationMembers,
	updateMemberRole,
	removeMember,
} from '../server/actions';

export function useOrganization() {
	return useQuery({
		queryKey: ['organization'],
		queryFn: () => getOrganization(),
	});
}

export function useOrganizationMembers() {
	return useQuery({
		queryKey: ['organization', 'members'],
		queryFn: () => getOrganizationMembers(),
	});
}

export function useUpdateOrganization() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: { name?: string }) => updateOrganization(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['organization'] });
		},
	});
}

export function useUpdateMemberRole() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ userId, role }: { userId: string; role: 'ADMIN' | 'DOCTOR' }) =>
			updateMemberRole(userId, role),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
		},
	});
}

export function useRemoveMember() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (userId: string) => removeMember(userId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
		},
	});
}
