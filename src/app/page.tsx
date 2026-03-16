import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/shared/core/auth/get-session';

export default async function Home() {
	const session = await getServerSession();

	if (!session) {
		redirect('/login');
	}

	// Logged-in users go to the redirect handler which routes to their org
	redirect('/redirect');
}
