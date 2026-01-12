export type InvitationType = 'email' | 'code';

export type InvitationRole = 'ADMIN' | 'DOCTOR';

export interface CreateInvitationData {
	email?: string;
	role?: InvitationRole;
	type: InvitationType;
	expiresInDays?: number;
}
