import { redirect } from 'next/navigation';

interface SettingsRootProps {
	params: Promise<{ orgSlug: string }>;
}

export default async function SettingsRoot({ params }: SettingsRootProps) {
	const { orgSlug } = await params;
	redirect(`/${orgSlug}/settings/basis`);
}

