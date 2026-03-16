import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { OrgProvider } from '@/src/shared/core/providers/org-provider';
import { ConditionalSidebar } from '@/src/shared/components/layout/ConditionalSidebar';
import { getOrganizationAccessState } from '@/src/shared/core/auth/organization-access';

interface OrgLayoutProps {
	children: React.ReactNode;
	params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}): Promise<Metadata> {
	const { orgSlug } = await params;
	const org = await prisma.organization.findUnique({
		where: { slug: orgSlug },
		select: { name: true },
	});

	return {
		title: {
			default: org?.name ?? 'Dashboard',
			template: `%s – ${org?.name ?? 'PodoImprove'} | PodoImprove`,
		},
		description: org
			? `Beheer patiënten, projecten en instellingen voor ${org.name} in PodoImprove.`
			: 'PodoImprove dashboard',
	};
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
	const { orgSlug } = await params;
	const session = await getServerSession();

	if (!session) {
		redirect('/login');
	}

	// Parallel queries - eliminates waterfall
	const [organization, user] = await Promise.all([
		prisma.organization.findUnique({ where: { slug: orgSlug } }),
		prisma.user.findUnique({ where: { id: session.user.id } }),
	]);

	if (!organization) {
		notFound();
	}

	if (!user || user.orgId !== organization.id) {
		// User doesn't belong to this org
		redirect('/');
	}

	const organizationAccess = await getOrganizationAccessState(organization.id);
	if (organizationAccess && !organizationAccess.isActive) {
		const closedUrl = new URL('/organization-closed', 'http://localhost');
		closedUrl.searchParams.set('org', organization.name);
		if (organizationAccess.closedReason) {
			closedUrl.searchParams.set('reason', organizationAccess.closedReason);
		}
		redirect(`${closedUrl.pathname}${closedUrl.search}`);
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
