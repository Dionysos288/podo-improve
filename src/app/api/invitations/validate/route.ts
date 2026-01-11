import { NextRequest, NextResponse } from 'next/server';
import { validateInvitation } from '@/src/features/invitations/server/actions';

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const code = searchParams.get('code');

		if (!code) {
			return NextResponse.json({ error: 'Code is verplicht' }, { status: 400 });
		}

		const invitation = await validateInvitation(code);

		return NextResponse.json(invitation);
	} catch (error) {
		console.error('Error validating invitation:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Er is een fout opgetreden',
			},
			{ status: 400 }
		);
	}
}
