'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';

type AgentUserSettings = {
	ideamakerPath?: string;
	agentToken?: string;
	agentLastSeenAt?: string;
};

function makeToken() {
	// Simple, URL-safe-ish token. Good enough for local agent bootstrap.
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function AgentSettingsCard() {
	const [isPending, startTransition] = useTransition();
	const [loaded, setLoaded] = useState(false);
	const [ideamakerPath, setIdeamakerPath] = useState('');
	const [agentToken, setAgentToken] = useState('');
	const [agentLastSeenAt, setAgentLastSeenAt] = useState<string | null>(null);

	const refreshStatus = () => {
		fetch('/api/settings/user')
			.then((r) => r.json())
			.then((settings: AgentUserSettings) => {
				setIdeamakerPath(settings.ideamakerPath ?? '');
				setAgentToken(settings.agentToken ?? '');
				setAgentLastSeenAt(settings.agentLastSeenAt ?? null);
			})
			.catch((err) => console.error('Failed to refresh agent status:', err))
			.finally(() => setLoaded(true));
	};

	useEffect(() => {
		refreshStatus();
		// Poll every 5 seconds to check if agent has pinged
		const interval = setInterval(refreshStatus, 5000);
		return () => clearInterval(interval);
	}, []);

	const save = () => {
		startTransition(async () => {
			const nextToken = agentToken || makeToken();
			setAgentToken(nextToken);
			await fetch('/api/settings/user', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ideamakerPath: ideamakerPath.trim() || undefined,
					agentToken: nextToken,
				}),
			});
			// Refresh status after save
			refreshStatus();
		});
	};

	const rotateToken = () => {
		const next = makeToken();
		setAgentToken(next);
		startTransition(async () => {
			await fetch('/api/settings/user', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentToken: next }),
			});
			// Refresh status after token rotation
			refreshStatus();
		});
	};

	return (
		<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
			<h3 className="text-sm font-semibold text-foreground">
				Lokale Print Agent
			</h3>
			<p className="mt-2 text-sm text-ui-muted">
				IdeaMaker draait op jouw pc. De webapp kan dit pad niet zelf gebruiken —
				de Print Agent leest dit en voert slicing lokaal uit.
			</p>
			<p className="mt-2 text-xs text-ui-muted">
				💡 Tip: Download de launcher en plaats deze in een map naar keuze. De
				agent bestanden worden automatisch gedownload wanneer je de launcher
				voor het eerst start.
			</p>

			<div className="mt-4 space-y-2">
				<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
					IdeaMaker pad (exe)
				</label>
				<Input
					value={ideamakerPath}
					onChange={(e) => setIdeamakerPath(e.target.value)}
					placeholder="C:\Program Files\Raise3D\ideaMaker\ideaMaker.exe"
					className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground"
				/>
			</div>

			<div className="mt-4 space-y-2">
				<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
					Agent token
				</label>
				<Input
					value={agentToken}
					readOnly
					placeholder="(Opslaan om token te genereren)"
					className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 font-mono text-foreground"
				/>
				<div className="flex items-center justify-between">
					<p className="text-xs text-ui-muted">
						Status:{' '}
						{agentLastSeenAt ? (
							<span className="text-ui-accent">
								gekoppeld ({new Date(agentLastSeenAt).toLocaleString('nl-NL')})
							</span>
						) : (
							<span className="text-ui-muted">(agent nog niet gekoppeld)</span>
						)}
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

			<div className="mt-4 space-y-3">
				<div className="flex items-center gap-3">
					<Button
						onClick={() => {
							window.location.href = '/api/agent/download';
						}}
						disabled={!loaded || !agentToken || isPending}
						variant="outline"
						className="flex-1 rounded-xl border border-ui-border px-4 py-2 font-medium text-foreground transition-colors hover:bg-ui-overlay disabled:opacity-50"
					>
						Agent downloaden
					</Button>
					<Button
						onClick={() => {
							window.location.href = '/api/agent/download?type=installer';
						}}
						disabled={!loaded || !agentToken || isPending}
						variant="outline"
						className="flex-1 rounded-xl border border-ui-border px-4 py-2 font-medium text-foreground transition-colors hover:bg-ui-overlay disabled:opacity-50"
					>
						Auto-start installeren
					</Button>
				</div>
				<Button
					onClick={save}
					disabled={!loaded || isPending}
					className="w-full rounded-xl bg-ui-accent px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
				>
					{isPending ? 'Opslaan…' : 'Opslaan'}
				</Button>
			</div>
		</div>
	);
}
