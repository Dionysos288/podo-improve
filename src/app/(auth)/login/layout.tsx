import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Inloggen',
	description:
		'Log in op uw PodoImprove-account om medische inlegzolen te ontwerpen en te beheren.',
};

export default function LoginLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
