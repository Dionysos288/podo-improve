'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getInvitations,
	createInvitation,
	revokeInvitation,
} from '../server/actions';

export function useInvitations() {
	return useQuery({
		queryKey: ['invitations'],
		queryFn: () => getInvitations(),
	});
}

export function useCreateInvitation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: {
			email?: string;
			role?: 'ADMIN' | 'DOCTOR';
			type: 'email' | 'code';
			expiresInDays?: number;
		}) => createInvitation(data),
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
