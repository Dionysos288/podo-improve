import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Organisatie gesloten',
	description:
		'Uw organisatie is momenteel niet actief. Neem contact op met PodoImprove voor meer informatie.',
};

export default function OrganizationClosedLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
