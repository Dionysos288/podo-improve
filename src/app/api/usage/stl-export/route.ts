import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import {
	assertStlQuotaAndRecordExport,
	StlQuotaExceededError,
	type StlExportKind,
} from '@/src/shared/core/platform/stlQuota';

const EXPORT_KINDS: StlExportKind[] = [
	'stl_left',
	'stl_right',
	'stl_pair',
	'gcode',
	'nc',
];

type Body = {
	exportKind?: StlExportKind;
	projectId?: string;
	designId?: string;
	resourceId?: string;
};

export async function POST(req: NextRequest) {
	try {
		const { session, orgId } = await requireOrganization();
		const body = (await req.json()) as Body;

		if (!body.exportKind || !EXPORT_KINDS.includes(body.exportKind)) {
			return NextResponse.json({ error: 'Ongeldig exportKind.' }, { status: 400 });
		}

		if (body.projectId) {
			const project = await prisma.project.findFirst({
				where: { id: body.projectId, patient: { orgId }, deletedAt: null },
			});
			if (!project) {
				return NextResponse.json({ error: 'Project niet gevonden' }, { status: 404 });
			}
		}

		const result = await assertStlQuotaAndRecordExport({
			orgId,
			userId: session.user.id,
			exportKind: body.exportKind,
			projectId: body.projectId ?? null,
			designId: body.designId ?? null,
			resourceId: body.resourceId ?? null,
		});

		return NextResponse.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof StlQuotaExceededError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Export registratie mislukt.',
			},
			{ status: 400 },
		);
	}
}
