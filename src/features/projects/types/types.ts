import type { Prisma, ProjectStatus, User } from '@prisma/client';

export type CreateProjectData = {
	patientId: string;
	doctorId?: string;
	name: string;
	date?: Date | string;
};

export type UpdateProjectData = Partial<{
	name: string;
	status: ProjectStatus;
	date: Date | string;
	doctorId?: string;
}>;

export type ProjectListItem = Pick<
	Prisma.ProjectGetPayload<{
		include: {
			patient: { select: { id: true; firstName: true; lastName: true } };
			doctor: { select: { id: true; name: true } };
			_count: { select: { scans: true; designs: true } };
		};
	}>,
	'id' | 'name' | 'date' | 'status' | 'createdAt' | 'patient' | 'doctor'
> & { scansCount: number; designsCount: number };

export interface CreateProjectModalProps {
	open: boolean;
	onClose: () => void;
	orgSlug: string;
	patientId?: string;
	patientName?: string;
}

export interface ProjectActionsProps {
	projectId: string;
	projectStatus: ProjectStatus;
	orgSlug: string;
	currentName: string;
	currentDoctorId: string | null;
}

export interface ProjectsClientProps {
	projects: ProjectListItem[];
	orgSlug: string;
	initialStatus?: ProjectStatus | '';
}

// Utility types
export type PatientOption = Pick<
	ProjectListItem['patient'],
	'id' | 'firstName' | 'lastName'
>;
export type Member = Pick<User, 'id' | 'name' | 'email'>;
