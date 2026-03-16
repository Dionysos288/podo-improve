import { NextRequest, NextResponse } from 'next/server';
import { createOrganization } from '@/src/features/organizations/server/actions';

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { name, slug, accessKey } = body;

		if (!name || !slug || !accessKey) {
			return NextResponse.json(
				{ error: 'Naam, URL en toegangssleutel zijn verplicht' },
				{ status: 400 }
			);
		}

		const organization = await createOrganization({ name, slug, accessKey });

		return NextResponse.json(organization, { status: 201 });
	} catch (error) {
		console.error('Error creating organization:', error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Er is een fout opgetreden' },
			{ status: 400 }
		);
	}
}
