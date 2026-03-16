import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { getOrganizationAccessState } from '@/src/shared/core/auth/organization-access';

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

	const organizationAccess = await getOrganizationAccessState(user.organization.id);
	if (organizationAccess && !organizationAccess.isActive) {
		const closedUrl = new URL('/organization-closed', 'http://localhost');
		closedUrl.searchParams.set('org', user.organization.name);
		if (organizationAccess.closedReason) {
			closedUrl.searchParams.set('reason', organizationAccess.closedReason);
		}
		redirect(`${closedUrl.pathname}${closedUrl.search}`);
	}

	// Redirect to the user's organization dashboard
	redirect(`/${user.organization.slug}`);
}
