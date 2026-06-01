import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from '@/src/shared/core/auth/get-session';
import { prisma } from '@/src/shared/core/db/prisma';
import { isPlatformAdminEmail } from '@/src/shared/core/auth/admin';
import { SettingsShell } from '@/src/features/settings/components/SettingsShell';
import { getVisibleSettingsTabs } from '@/src/features/settings/navigation/settings-tabs';

export const metadata: Metadata = {
	title: 'Instellingen',
	description:
		'Beheer de instellingen van uw organisatie: gebruikers, plan, 3D-printer, MDR en meer.',
};

interface SettingsLayoutProps {
	children: React.ReactNode;
	params: Promise<{ orgSlug: string }>;
}

export default async function SettingsLayout({
	children,
	params,
}: SettingsLayoutProps) {
	const { orgSlug } = await params;
	const [session, org] = await Promise.all([
		getServerSession(),
		prisma.organization.findUnique({ where: { slug: orgSlug } }),
	]);

	if (!session) {
		redirect('/login');
	}

	if (!org) redirect('/');

	const tabs = getVisibleSettingsTabs({
		isPlatformAdmin: isPlatformAdminEmail(session.user.email),
	});

	return (
		<SettingsShell orgSlug={orgSlug} orgName={org.name} tabs={tabs}>
			{children}
		</SettingsShell>
	);
}

