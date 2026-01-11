import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProject } from '@/src/features/projects/server/actions';

const updateProjectSchema = z.object({
	name: z.string().min(1).optional(),
	date: z.string().optional(),
	status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED']).optional(),
});

// GET /api/projects/[id] - Get project by ID
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const project = await getProject(id);

		if (!project || project.deletedAt) {
			return NextResponse.json({ error: 'Project not found' }, { status: 404 });
		}

		return NextResponse.json({
			id: project.id,
			name: project.name,
			date: project.date,
			status: project.status,
			createdAt: project.createdAt,
			patient: {
				id: project.patient.id,
				firstName: project.patient.firstName,
				lastName: project.patient.lastName,
			},
			doctor: project.doctor
				? {
						id: project.doctor.id,
						name: project.doctor.name,
						email: project.doctor.email,
				  }
				: null,
			scans: project.scans.map((scan) => ({
				id: scan.id,
				projectId: scan.projectId,
				footSide: scan.footSide.toLowerCase(),
				stlUrl: scan.stlUrl,
				uploadedBy: scan.uploadedBy,
				metadata: scan.metadata,
				createdAt: scan.createdAt,
			})),
			designs: project.designs.map((design) => ({
				id: design.id,
				projectId: design.projectId,
				parameters: design.parameters,
				elements: design.elements,
				matchTransform: design.matchTransform,
				stlUrl: design.stlUrl,
				gcodeUrl: design.gcodeUrl,
				version: design.version,
				parentDesignId: design.parentDesignId,
				createdAt: design.createdAt,
			})),
		});
	} catch (error) {
		console.error('Error fetching project:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to fetch project',
			},
			{ status: 500 }
		);
	}
}

// PUT /api/projects/[id] - Update project
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const body = await request.json();
		const validated = updateProjectSchema.parse(body);

		const { updateProject } = await import(
			'@/src/features/projects/server/actions'
		);
		const updatedProject = await updateProject(id, {
			name: validated.name,
			date: validated.date,
			status: validated.status,
		});

		return NextResponse.json(updatedProject);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: 'Validation error', details: error.issues },
				{ status: 400 }
			);
		}
		console.error('Error updating project:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to update project',
			},
			{ status: 500 }
		);
	}
}

// DELETE /api/projects/[id] - Soft delete project
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const { deleteProject } = await import(
			'@/src/features/projects/server/actions'
		);
		await deleteProject(id);

		return NextResponse.json({ message: 'Project deleted successfully' });
	} catch (error) {
		console.error('Error deleting project:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to delete project',
			},
			{ status: 500 }
		);
	}
}
