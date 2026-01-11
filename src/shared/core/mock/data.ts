/**
 * Mock data for development
 * Replace with actual database queries when ready
 */

export const mockOrganizations = [
	{
		id: 'org-1',
		name: 'Medical Clinic Amsterdam',
		createdAt: new Date('2024-01-15'),
	},
];

export const mockUsers = [
	{
		id: 'user-1',
		orgId: 'org-1',
		email: 'doctor@clinic.nl',
		name: 'Dr. Jan van der Berg',
		role: 'DOCTOR' as const,
		createdAt: new Date('2024-01-15'),
	},
	{
		id: 'user-2',
		orgId: 'org-1',
		email: 'admin@clinic.nl',
		name: 'Admin User',
		role: 'ADMIN' as const,
		createdAt: new Date('2024-01-15'),
	},
];

export const mockPatients = [
	{
		id: 'patient-1',
		orgId: 'org-1',
		firstName: 'Ekrem',
		lastName: 'Zeneli',
		birthDate: new Date('1985-05-15'),
		notes: 'Patient requires custom insoles for flat feet',
		createdAt: new Date('2024-01-20'),
		deletedAt: null,
	},
	{
		id: 'patient-2',
		orgId: 'org-1',
		firstName: 'Maria',
		lastName: 'Garcia',
		birthDate: new Date('1990-08-22'),
		notes: 'Diabetic patient, needs special attention',
		createdAt: new Date('2024-01-25'),
		deletedAt: null,
	},
	{
		id: 'patient-3',
		orgId: 'org-1',
		firstName: 'John',
		lastName: 'Smith',
		birthDate: new Date('1978-03-10'),
		notes: null,
		createdAt: new Date('2024-02-01'),
		deletedAt: null,
	},
];

export const mockProjects = [
	{
		id: 'project-1',
		patientId: 'patient-1',
		doctorId: 'user-1',
		name: 'Project for Ekrem Zeneli',
		date: new Date('2024-01-20'),
		status: 'IN_PROGRESS' as const,
		createdAt: new Date('2024-01-20'),
		deletedAt: null,
	},
	{
		id: 'project-2',
		patientId: 'patient-2',
		doctorId: 'user-1',
		name: 'Project for Maria Garcia',
		date: new Date('2024-01-25'),
		status: 'DRAFT' as const,
		createdAt: new Date('2024-01-25'),
		deletedAt: null,
	},
	{
		id: 'project-3',
		patientId: 'patient-1',
		doctorId: 'user-1',
		name: 'Follow-up Project for Ekrem Zeneli',
		date: new Date('2024-02-05'),
		status: 'COMPLETED' as const,
		createdAt: new Date('2024-02-05'),
		deletedAt: null,
	},
];

export const mockScans = [
	{
		id: 'scan-1',
		projectId: 'project-1',
		footSide: 'LEFT' as const,
		stlUrl: '/STL/Ekrem_Zeneli_055037_000528_L.stl',
		uploadedBy: 'user-1',
		metadata: {
			filename: 'Ekrem_Zeneli_055037_000528_L.stl',
			size: 1300000,
			uploaded_at: new Date('2024-01-20').toISOString(),
		},
		createdAt: new Date('2024-01-20'),
	},
	{
		id: 'scan-2',
		projectId: 'project-1',
		footSide: 'RIGHT' as const,
		stlUrl: '/STL/Ekrem_Zeneli_055037_000528_R.stl',
		uploadedBy: 'user-1',
		metadata: {
			filename: 'Ekrem_Zeneli_055037_000528_R.stl',
			size: 1400000,
			uploaded_at: new Date('2024-01-20').toISOString(),
		},
		createdAt: new Date('2024-01-20'),
	},
];

export const mockDesigns = [
	{
		id: 'design-1',
		projectId: 'project-1',
		parameters: {
			thickness: 5,
			material: 'TPU',
			hardness: 70,
		},
		elements: [],
		matchTransform: null,
		stlUrl: null,
		gcodeUrl: null,
		version: 1,
		parentDesignId: null,
		createdAt: new Date('2024-01-21'),
		deletedAt: null,
	},
];

// Helper functions to get related data
export function getPatientProjects(patientId: string) {
	return mockProjects.filter((p) => p.patientId === patientId);
}

export function getProjectScans(projectId: string) {
	return mockScans.filter((s) => s.projectId === projectId);
}

export function getProjectDesigns(projectId: string) {
	return mockDesigns.filter((d) => d.projectId === projectId);
}

export function getPatientById(id: string) {
	return mockPatients.find((p) => p.id === id);
}

export function getProjectById(id: string) {
	return mockProjects.find((p) => p.id === id);
}

export function getUserById(id: string) {
	return mockUsers.find((u) => u.id === id);
}

