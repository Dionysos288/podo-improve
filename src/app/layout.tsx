import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/src/shared/core/providers/query-provider';

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
});

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	title: {
		default: 'PodoImprove – CAD-software voor medische zolen',
		template: '%s | PodoImprove',
	},
	description:
		'PodoImprove is professionele CAD-software voor het ontwerpen en produceren van medische inlegzolen. Ontwerp, slijp en print orthopedische zolen vanuit één platform.',
	keywords: [
		'PodoImprove',
		'medische zolen',
		'CAD-software',
		'orthopedische inlegzolen',
		'podologie',
		'3D-printen',
		'zolenontwerp',
	],
	authors: [{ name: 'PodoImprove' }],
	creator: 'PodoImprove',
	publisher: 'PodoImprove',
	robots: { index: true, follow: true },
	openGraph: {
		type: 'website',
		locale: 'nl_BE',
		siteName: 'PodoImprove',
		title: 'PodoImprove – CAD-software voor medische zolen',
		description:
			'Professionele CAD-software voor het ontwerpen en produceren van medische inlegzolen.',
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="nl">
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased root`}
			>
				<QueryProvider>{children}</QueryProvider>
			</body>
		</html>
	);
}
