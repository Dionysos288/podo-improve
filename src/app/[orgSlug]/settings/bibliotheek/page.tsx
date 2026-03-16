import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Bibliotheek',
	description: 'Beheer uw materiaalbibliotheek en zolensjablonen.',
};

export default function SettingsLibraryPage() {
	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<h2 className="text-xl font-semibold text-foreground">Bibliotheek</h2>
			<p className="mt-2 text-sm text-ui-muted">Nog leeg.</p>
		</div>
	);
}

