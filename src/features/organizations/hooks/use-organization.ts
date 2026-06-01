'use client';

import type { UpdateMemberRoleData } from '../types/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getOrganization,
	updateOrganization,
	updateMemberRole,
	removeMember,
} from '../server/actions';
import { organizationMembersQueryOptions } from '../queries/organization-query-options';

export function useOrganization() {
	return useQuery({
		queryKey: ['organization'],
		queryFn: () => getOrganization(),
	});
}

export function useOrganizationMembers() {
	return useQuery(organizationMembersQueryOptions());
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
		mutationFn: ({ userId, role }: UpdateMemberRoleData) =>
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
