import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Uitnodiging accepteren',
	description:
		'Accepteer uw uitnodiging om lid te worden van een PodoImprove-organisatie.',
};

export default function JoinLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
