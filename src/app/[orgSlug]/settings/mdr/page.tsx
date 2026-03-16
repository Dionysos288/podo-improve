import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'MDR-verklaring',
	description: 'Configureer uw MDR-verklaring: bedrijfslogo, gegevens, introductie en disclaimer.',
};

export default function SettingsMdrPage() {
	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<h2 className="text-xl font-semibold text-foreground">MDR</h2>
			<p className="mt-2 text-sm text-ui-muted">
				MDR-verklaring instellingen (logo, bedrijfsgegevens, introductie/afsluiting/disclaimer).
			</p>
		</div>
	);
}

