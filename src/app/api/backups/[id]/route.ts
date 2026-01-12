import { NextRequest, NextResponse } from 'next/server';
import { deleteBackup } from '@/src/features/backups/server/actions';

export async function DELETE(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		await deleteBackup(id);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Failed to delete backup' },
			{ status: 400 }
		);
	}
}

