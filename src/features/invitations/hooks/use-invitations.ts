'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	createInvitation,
	revokeInvitation,
} from '../server/actions';
import { CreateInvitationData } from '../types/types';
import { invitationsQueryOptions } from '../queries/invitation-query-options';

export function useInvitations() {
	return useQuery(invitationsQueryOptions());
}

export function useCreateInvitation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: CreateInvitationData) => createInvitation(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['invitations'] });
		},
	});
}

export function useRevokeInvitation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (invitationId: string) => revokeInvitation(invitationId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['invitations'] });
		},
	});
}
