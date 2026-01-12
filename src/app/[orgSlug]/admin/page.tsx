import { redirect } from 'next/navigation';

interface AdminPageProps {
	params: Promise<{ orgSlug: string }>;
}

export default async function AdminPage({ params }: AdminPageProps) {
	const { orgSlug } = await params;
	redirect(`/${orgSlug}/settings/gebruikers`);
}
