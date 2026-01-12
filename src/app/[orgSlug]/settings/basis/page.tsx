import { AgentSettingsCard } from '@/src/features/settings/components/AgentSettingsCard';

export default function SettingsBasisPage() {
	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
				<h2 className="text-xl font-semibold text-foreground">Basis</h2>
				<p className="mt-2 text-sm text-ui-muted">
					Basisinstellingen (geen 2D scanner).
				</p>

				<div className="mt-6 grid gap-4 md:grid-cols-2">
					<div className="rounded-2xl border border-ui-border bg-ui-card p-4">
						<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Taal
						</p>
						<p className="mt-2 text-sm text-foreground">Nederlands</p>
					</div>
					<div className="rounded-2xl border border-ui-border bg-ui-card p-4">
						<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Thema
						</p>
						<p className="mt-2 text-sm text-foreground">Dark</p>
					</div>
					<div className="rounded-2xl border border-ui-border bg-ui-card p-4">
						<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Patiënt weergave
						</p>
						<p className="mt-2 text-sm text-foreground">Compact</p>
					</div>
					<div className="rounded-2xl border border-ui-border bg-ui-card p-4">
						<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Standaard export
						</p>
						<p className="mt-2 text-sm text-foreground">—</p>
					</div>
				</div>
			</div>

			<AgentSettingsCard />
		</div>
	);
}

