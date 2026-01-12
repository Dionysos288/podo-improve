import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/shared/core/db/prisma';
import { requireOrganization } from '@/src/shared/core/auth/get-session';
import fs from 'fs/promises';
import path from 'path';

function backupsDir() {
	return path.join(process.cwd(), 'backups');
}

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const { orgId } = await requireOrganization();

	const backup = await prisma.backup.findFirst({
		where: { id, orgId },
		select: { id: true, createdAt: true },
	});
	if (!backup) {
		return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
	}

	const filePath = path.join(backupsDir(), orgId, `${backup.id}.json`);
	try {
		const contents = await fs.readFile(filePath);
		const filename = `backup-${backup.createdAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

		return new NextResponse(contents, {
			status: 200,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
			},
		});
	} catch {
		return NextResponse.json(
			{ error: 'Backup file not found on server' },
			{ status: 404 }
		);
	}
}

