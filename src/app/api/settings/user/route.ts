import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	return value as Record<string, unknown>;
}

export async function GET() {
	const session = await requireSession();
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { settings: true },
	});
	return NextResponse.json(user?.settings ?? {});
}

export async function PUT(req: NextRequest) {
	try {
		const session = await requireSession();
		const patch = (await req.json()) as Record<string, unknown>;

		const existing = await prisma.user.findUnique({
			where: { id: session.user.id },
			select: { settings: true },
		});

		const merged = { ...asObject(existing?.settings), ...patch };
		const updated = await prisma.user.update({
			where: { id: session.user.id },
			data: { settings: merged },
			select: { settings: true },
		});

		return NextResponse.json(updated.settings ?? {});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Failed to update settings' },
			{ status: 400 }
		);
	}
}

