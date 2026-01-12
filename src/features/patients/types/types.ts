import type { Prisma } from '@prisma/client';

export type CreatePatientData = Pick<
	Prisma.PatientCreateInput,
	'firstName' | 'lastName' | 'birthDate' | 'notes'
>;

export type UpdatePatientData = Partial<
	Pick<
		Prisma.PatientUpdateInput,
		'firstName' | 'lastName' | 'birthDate' | 'notes'
	>
>;

export type PatientListItem = Pick<
	Prisma.PatientGetPayload<{
		include: { _count: { select: { projects: true } } };
	}>,
	'id' | 'firstName' | 'lastName' | 'birthDate' | 'notes' | 'createdAt'
> & { projectsCount: number };
