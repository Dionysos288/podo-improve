import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { OrgProvider } from '@/src/shared/core/providers/org-provider';
import { ConditionalSidebar } from '@/src/shared/components/layout/ConditionalSidebar';

interface OrgLayoutProps {
	children: React.ReactNode;
	params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
	const { orgSlug } = await params;
	const session = await getServerSession();

	if (!session) {
		redirect('/login');
	}

	// Get the organization by slug
	const organization = await prisma.organization.findUnique({
		where: { slug: orgSlug },
	});

	if (!organization) {
		notFound();
	}

	// Check if user belongs to this organization
	const user = await prisma.user.findUnique({
		where: { id: session.user.id },
	});

	if (!user || user.orgId !== organization.id) {
		// User doesn't belong to this org
		redirect('/');
	}

	return (
		<OrgProvider
			organization={{
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
			}}
		>
			<ConditionalSidebar
				orgName={organization.name}
				orgSlug={organization.slug}
				userName={session.user.name}
				userRole={user.role}
			>
				{children}
			</ConditionalSidebar>
		</OrgProvider>
	);
}
