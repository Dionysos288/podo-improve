import { NextRequest, NextResponse } from 'next/server';
import { validateRegistrationAccessKey } from '@/src/shared/core/platform/access-keys';

export async function GET(request: NextRequest) {
	try {
		const code = request.nextUrl.searchParams.get('code');
		const email = request.nextUrl.searchParams.get('email');

		if (!code) {
			return NextResponse.json({ error: 'Toegangssleutel ontbreekt' }, { status: 400 });
		}

		const key = await validateRegistrationAccessKey(code, email);
		return NextResponse.json({
			id: key.id,
			code: key.code,
			plan: key.plan,
			stlLimit: key.stlLimit,
			label: key.label,
			expiresAt: key.expiresAt,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Toegangssleutel ongeldig' },
			{ status: 400 }
		);
	}
}
