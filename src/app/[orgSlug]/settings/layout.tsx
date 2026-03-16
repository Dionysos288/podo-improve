import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { isPlatformAdminEmail } from '@/src/shared/core/auth/admin';

export const metadata: Metadata = {
	title: 'Instellingen',
	description:
		'Beheer de instellingen van uw organisatie: gebruikers, plan, 3D-printer, bibliotheek en meer.',
};

interface SettingsLayoutProps {
	children: React.ReactNode;
	params: Promise<{ orgSlug: string }>;
}

const baseTabs = [
	{ label: 'Basis', href: '/settings/basis' },
	{ label: 'Gebruik', href: '/settings/gebruik' },
	{ label: 'MDR', href: '/settings/mdr' },
	{ label: 'Gebruikers', href: '/settings/gebruikers' },
	{ label: 'Backup & Migratie', href: '/settings/backup' },
	{ label: 'Bibliotheek', href: '/settings/bibliotheek' },
	{ label: '3D Printer', href: '/settings/3d-printer' },
];

export default async function SettingsLayout({
	children,
	params,
}: SettingsLayoutProps) {
	const { orgSlug } = await params;
	const session = await getServerSession();

	if (!session) {
		redirect('/login');
	}

	const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
	if (!org) redirect('/');

	const tabs = isPlatformAdminEmail(session.user.email)
		? [{ label: 'Admin', href: '/settings/admin' }, ...baseTabs]
		: baseTabs;

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold text-foreground">Instellingen</h1>
						<p className="mt-2 text-ui-muted">{org.name}</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2 border-b border-ui-border pb-3">
					{tabs.map((tab) => (
						<Link
							key={tab.href}
							href={`/${orgSlug}${tab.href}`}
							className="rounded-xl border border-ui-border bg-ui-card px-4 py-2 text-sm font-medium text-ui-muted transition-colors hover:border-ui-accent/50 hover:text-foreground"
						>
							{tab.label}
						</Link>
					))}
				</div>

				{children}
			</div>
		</div>
	);
}

