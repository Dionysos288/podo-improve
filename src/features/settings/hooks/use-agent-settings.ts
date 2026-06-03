'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

export type AgentStatusState =
	| 'loading'
	| 'uninstalled'
	| 'offline'
	| 'online'
	| 'online-no-slicer';

export interface AgentStatus {
	state: AgentStatusState;
	agentOnline: boolean;
	agentVersion: string | null;
	latestVersion: string | null;
	updateAvailable: boolean;
	slicerOk: boolean;
	slicerPath: string | null;
	lastSeenAt: string | null;
}

interface PrinterConfigResponse {
	slicer?: {
		configured?: boolean;
		agentOnline?: boolean;
		agentLastSeenAt?: string | null;
		agentVersion?: string | null;
		agentSlicerOk?: boolean;
		agentSlicerPath?: string | null;
		latestVersion?: string | null;
		updateAvailable?: boolean;
	};
}

function makeToken() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function deriveStatus(cfg: PrinterConfigResponse): AgentStatus {
	const s = cfg.slicer ?? {};
	const lastSeenAt = s.agentLastSeenAt ?? null;
	const agentOnline = Boolean(s.agentOnline);
	const slicerOk = Boolean(s.agentSlicerOk);

	let state: AgentStatusState;
	if (!lastSeenAt) state = 'uninstalled';
	else if (!agentOnline) state = 'offline';
	else if (!slicerOk) state = 'online-no-slicer';
	else state = 'online';

	return {
		state,
		agentOnline,
		agentVersion: s.agentVersion ?? null,
		latestVersion: s.latestVersion ?? null,
		updateAvailable: Boolean(s.updateAvailable),
		slicerOk,
		slicerPath: s.agentSlicerPath ?? null,
		lastSeenAt,
	};
}

/** State + actions for the Lokale Print Agent settings card. */
export function useAgentSettings() {
	const [isPending, startTransition] = useTransition();
	const [loaded, setLoaded] = useState(false);
	const [token, setToken] = useState('');
	const [prusaSlicerPath, setPrusaSlicerPath] = useState('');
	const [isDirty, setIsDirty] = useState(false);
	const isDirtyRef = useRef(false);
	const [installDownloaded, setInstallDownloaded] = useState(false);
	const [status, setStatus] = useState<AgentStatus>({
		state: 'loading',
		agentOnline: false,
		agentVersion: null,
		latestVersion: null,
		updateAvailable: false,
		slicerOk: false,
		slicerPath: null,
		lastSeenAt: null,
	});

	useEffect(() => {
		isDirtyRef.current = isDirty;
	}, [isDirty]);

	const refresh = useCallback(() => {
		fetch('/api/settings/user')
			.then((r) => r.json())
			.then((settings: { agentToken?: string; prusaSlicerPath?: string }) => {
				setToken(settings.agentToken ?? '');
				if (!isDirtyRef.current) setPrusaSlicerPath(settings.prusaSlicerPath ?? '');
			})
			.catch(() => {});
		fetch('/api/printer/config')
			.then((r) => r.json())
			.then((cfg: PrinterConfigResponse) => setStatus(deriveStatus(cfg)))
			.catch(() => {})
			.finally(() => setLoaded(true));
	}, []);

	useEffect(() => {
		refresh();
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, 15_000);
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [refresh]);

	const save = useCallback(() => {
		startTransition(async () => {
			const nextToken = token || makeToken();
			setToken(nextToken);
			const res = await fetch('/api/settings/user', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prusaSlicerPath: prusaSlicerPath.trim() || undefined,
					agentToken: nextToken,
				}),
			});
			if (res.ok) {
				setIsDirty(false);
				refresh();
			}
		});
	}, [token, prusaSlicerPath, refresh]);

	const rotateToken = useCallback(() => {
		const next = makeToken();
		setToken(next);
		startTransition(async () => {
			await fetch('/api/settings/user', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentToken: next }),
			});
			refresh();
		});
	}, [refresh]);

	const updatePrusaPath = useCallback((value: string) => {
		setPrusaSlicerPath(value);
		setIsDirty(true);
	}, []);

	const downloadSetup = useCallback(() => {
		setInstallDownloaded(true);
		window.location.href = '/api/agent/download';
	}, []);

	return {
		loaded,
		isPending,
		token,
		prusaSlicerPath,
		updatePrusaPath,
		status,
		save,
		rotateToken,
		downloadSetup,
		installDownloaded,
	};
}
