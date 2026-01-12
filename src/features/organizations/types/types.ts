export type MemberRole = 'ADMIN' | 'DOCTOR';

export interface UpdateMemberRoleData {
	userId: string;
	role: MemberRole;
}
