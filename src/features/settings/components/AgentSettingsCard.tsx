'use client';

import { useState } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import {
	useAgentSettings,
	type AgentStatus,
} from '@/src/features/settings/hooks/use-agent-settings';

function formatSeen(at: string | null) {
	if (!at) return null;
	try {
		return new Date(at).toLocaleString('nl-NL');
	} catch {
		return at;
	}
}

function StatusBlock({ status }: { status: AgentStatus }) {
	const dot: Record<string, string> = {
		loading: 'bg-ui-muted',
		uninstalled: 'bg-ui-muted',
		offline: 'bg-amber-400',
		'online-no-slicer': 'bg-amber-400',
		online: 'bg-ui-accent',
	};
	const label: Record<string, string> = {
		loading: 'Status laden…',
		uninstalled: 'Nog niet geïnstalleerd',
		offline: 'Offline — de agent draait niet',
		'online-no-slicer': 'Verbonden, maar PrusaSlicer niet gevonden',
		online: status.agentVersion ? `Verbonden (v${status.agentVersion})` : 'Verbonden',
	};
	const seen = formatSeen(status.lastSeenAt);

	return (
		<div className="rounded-xl border border-ui-border bg-ui-card p-4">
			<div className="flex items-center gap-2">
				<span className={`h-2.5 w-2.5 rounded-full ${dot[status.state] ?? 'bg-ui-muted'}`} />
				<span className="text-sm font-medium text-foreground">
					{label[status.state] ?? status.state}
				</span>
				{status.updateAvailable && (
					<span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-300">
						Update beschikbaar — wordt automatisch geïnstalleerd
					</span>
				)}
			</div>

			{status.state === 'online-no-slicer' && (
				<p className="mt-2 text-xs text-amber-300/90">
					Installeer PrusaSlicer of stel het pad handmatig in onder Geavanceerd.
				</p>
			)}
			{status.state === 'offline' && seen && (
				<p className="mt-2 text-xs text-ui-muted">Laatst gezien: {seen}</p>
			)}
			{status.state === 'online' && (
				<p className="mt-2 text-xs text-ui-muted">
					PrusaSlicer: {status.slicerPath ?? 'gevonden'}
				</p>
			)}
		</div>
	);
}

export function AgentSettingsCard() {
	const {
		loaded,
		isPending,
		token,
		prusaSlicerPath,
		updatePrusaPath,
		status,
		save,
		rotateToken,
		downloadSetup,
	} = useAgentSettings();
	const [showAdvanced, setShowAdvanced] = useState(false);

	const installed = status.state !== 'uninstalled' && status.state !== 'loading';

	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<h3 className="text-sm font-semibold text-foreground">Lokale Print Agent</h3>
			<p className="mt-2 text-sm text-ui-muted">
				De Print Agent draait op jouw pc en voert het slicen lokaal uit met
				PrusaSlicer. Eén keer installeren — daarna start hij automatisch op de
				achtergrond.
			</p>

			<div className="mt-4">
				<StatusBlock status={status} />
			</div>

			<div className="mt-4 space-y-3">
				<Button
					onClick={downloadSetup}
					disabled={!loaded || isPending}
					className="w-full rounded-xl bg-ui-accent px-4 py-3 font-semibold text-slate-900 disabled:opacity-50"
				>
					{installed ? 'Opnieuw installeren / repareren' : 'Auto-start installeren'}
				</Button>
				<p className="text-xs text-ui-muted">
					Download het installatiebestand en dubbelklik erop. PrusaSlicer wordt
					automatisch gedetecteerd. Updates worden vanzelf geïnstalleerd.
				</p>
			</div>

			<button
				type="button"
				onClick={() => setShowAdvanced((v) => !v)}
				className="mt-4 text-xs font-medium text-ui-muted transition-colors hover:text-foreground"
			>
				{showAdvanced ? 'Geavanceerd verbergen' : 'Geavanceerd tonen'}
			</button>

			{showAdvanced && (
				<div className="mt-3 space-y-4 border-t border-ui-border pt-4">
					<div className="space-y-2">
						<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							PrusaSlicer pad (optioneel — alleen als auto-detectie faalt)
						</label>
						<Input
							variant="dark"
							value={prusaSlicerPath}
							onChange={(e) => updatePrusaPath(e.target.value)}
							placeholder="C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe"
							className="rounded-xl px-4 py-3"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
							Agent token
						</label>
						<Input
							variant="dark"
							value={token}
							readOnly
							placeholder="(Opslaan om token te genereren)"
							className="rounded-xl px-4 py-3 font-mono"
						/>
						<div className="flex items-center justify-between">
							<p className="text-xs text-ui-muted">
								Verander het token alleen als het gelekt is — je moet dan
								opnieuw installeren.
							</p>
							<button
								type="button"
								onClick={rotateToken}
								disabled={!loaded || isPending}
								className="text-xs font-medium text-ui-muted transition-colors hover:text-foreground disabled:opacity-50"
							>
								Token vernieuwen
							</button>
						</div>
					</div>

					<Button
						onClick={save}
						disabled={!loaded || isPending}
						variant="outline"
						className="w-full rounded-xl border border-ui-border px-4 py-2 font-medium text-foreground transition-colors hover:bg-ui-overlay disabled:opacity-50"
					>
						{isPending ? 'Opslaan…' : 'Opslaan'}
					</Button>

					<p className="text-xs text-ui-muted">
						Auto-start verwijderen: open een terminal en voer
						<span className="mx-1 font-mono text-foreground">
							podo-print-agent uninstall
						</span>
						uit, of verwijder de taak &quot;Podo Improve Print Agent&quot; in
						Taakplanner.
					</p>
				</div>
			)}
		</div>
	);
}
