import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';

export default async function RedirectPage() {
	const session = await getServerSession();

	if (!session) {
		redirect('/login');
	}

	// Get the user's organization
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
		include: { organization: true },
	});

	if (!user?.organization) {
		// User doesn't have an organization, redirect to register to create one
		redirect('/register');
	}

	// Redirect to the user's organization dashboard
	redirect(`/${user.organization.slug}`);
}
