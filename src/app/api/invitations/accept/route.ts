import { NextRequest, NextResponse } from 'next/server';
import { acceptInvitation } from '@/src/features/invitations/server/actions';

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { code } = body;

		if (!code) {
			return NextResponse.json(
				{ error: 'Code is verplicht' },
				{ status: 400 }
			);
		}

		const result = await acceptInvitation(code);

		return NextResponse.json(result);
	} catch (error) {
		console.error('Error accepting invitation:', error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Er is een fout opgetreden' },
			{ status: 400 }
		);
	}
}
