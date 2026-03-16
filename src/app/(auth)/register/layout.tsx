import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Registreren',
	description:
		'Maak een nieuw PodoImprove-account aan en registreer uw bedrijf om aan de slag te gaan met het ontwerpen van medische inlegzolen.',
};

export default function RegisterLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
