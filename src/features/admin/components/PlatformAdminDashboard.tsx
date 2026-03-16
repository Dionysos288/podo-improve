'use client';

import { useMemo, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Select } from '@/src/shared/components/ui/select';
import {
	createPlatformAccessKeyAction,
	deletePlatformAccessKeyAction,
	updateOrganizationAccessAction,
	updateOrganizationDeadlineAction,
	updateOrganizationPlanAction,
	type PlatformDashboardData,
} from '@/src/features/admin/server/platform-actions';
import { PLAN_DEFINITIONS, isCustomPlan, formatPlanLabel, type CompanyPlan } from '@/src/shared/core/platform/plans';
import { USAGE_EVENT_LABELS } from '@/src/shared/core/platform/usage';

type Tab = 'organizations' | 'keys';

interface PlatformAdminDashboardProps {
	data: PlatformDashboardData;
}

const PLAN_SELECT_OPTIONS = PLAN_DEFINITIONS.map((d) => ({ value: d.plan, label: d.label }));

function StatusBadge({ active }: { active: boolean }) {
	return (
		<span
			className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
				active
					? 'bg-emerald-500/15 text-emerald-400'
					: 'bg-red-500/15 text-red-400'
			}`}
		>
			{active ? 'Actief' : 'Gesloten'}
		</span>
	);
}

function KeyStatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		ACTIVE: 'bg-emerald-500/15 text-emerald-400',
		REDEEMED: 'bg-blue-500/15 text-blue-400',
		DISABLED: 'bg-slate-500/15 text-slate-400',
		EXPIRED: 'bg-red-500/15 text-red-400',
	};
	const labels: Record<string, string> = {
		ACTIVE: 'Actief',
		REDEEMED: 'Ingewisseld',
		DISABLED: 'Uitgeschakeld',
		EXPIRED: 'Verlopen',
	};
	return (
		<span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? colors.DISABLED}`}>
			{labels[status] ?? status}
		</span>
	);
}

function formatDate(date: Date | string | null | undefined) {
	if (!date) return '—';
	return new Date(date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Convert Date/string to yyyy-MM-dd for <input type="date"> */
function toDateInputValue(date: Date | string | null | undefined): string {
	if (!date) return '';
	const d = new Date(date);
	return d.toISOString().slice(0, 10);
}

export function PlatformAdminDashboard({ data }: PlatformAdminDashboardProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const [tab, setTab] = useState<Tab>('organizations');
	const [orgSearch, setOrgSearch] = useState('');
	const [keySearch, setKeySearch] = useState('');
	const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
	const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	// New key form
	const [form, setForm] = useState({
		plan: 'STL200' as CompanyPlan,
		stlLimit: '200',
		label: '',
		createdForEmail: '',
		notes: '',
	});
	const [showNewKeyForm, setShowNewKeyForm] = useState(false);

	// ---------- Filtered data ----------
	const filteredOrgs = useMemo(() => {
		if (!orgSearch.trim()) return data.organizations;
		const q = orgSearch.toLowerCase();
		return data.organizations.filter(
			(o) =>
				o.name.toLowerCase().includes(q) ||
				o.slug.toLowerCase().includes(q) ||
				o.users.some((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
		);
	}, [data.organizations, orgSearch]);

	const filteredKeys = useMemo(() => {
		if (!keySearch.trim()) return data.accessKeys;
		const q = keySearch.toLowerCase();
		return data.accessKeys.filter(
			(k) =>
				k.code.toLowerCase().includes(q) ||
				(k.label ?? '').toLowerCase().includes(q) ||
				(k.createdForEmail ?? '').toLowerCase().includes(q) ||
				(k.organization?.name ?? '').toLowerCase().includes(q)
		);
	}, [data.accessKeys, keySearch]);

	// ---------- Actions ----------
	const flash = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4000); };

	const handleCreateKey = () => {
		startTransition(async () => {
			try {
				const created = await createPlatformAccessKeyAction({
					plan: form.plan,
					stlLimit: isCustomPlan(form.plan) ? Number(form.stlLimit) : undefined,
					label: form.label,
					createdForEmail: form.createdForEmail,
					notes: form.notes,
				});
				flash(`Sleutel aangemaakt: ${created.code}`);
				setShowNewKeyForm(false);
				setForm({ plan: 'STL200', stlLimit: '200', label: '', createdForEmail: '', notes: '' });
				router.refresh();
			} catch (error) {
				flash(error instanceof Error ? error.message : 'Aanmaken mislukt');
			}
		});
	};

	const handleDeleteKey = (keyId: string) => {
		if (!confirm('Weet je zeker dat je deze sleutel wilt verwijderen?')) return;
		startTransition(async () => {
			try {
				await deletePlatformAccessKeyAction(keyId);
				flash('Sleutel verwijderd');
				setExpandedKeyId(null);
				router.refresh();
			} catch (error) {
				flash(error instanceof Error ? error.message : 'Verwijderen mislukt');
			}
		});
	};

	const handlePlanUpdate = (orgId: string, plan: CompanyPlan, stlLimit: number) => {
		startTransition(async () => {
			try {
				await updateOrganizationPlanAction({ organizationId: orgId, plan, stlLimit });
				flash('Plan bijgewerkt');
				router.refresh();
			} catch (error) {
				flash(error instanceof Error ? error.message : 'Bijwerken mislukt');
			}
		});
	};

	const handleDeadlineUpdate = (orgId: string, dateValue: string) => {
		startTransition(async () => {
			try {
				await updateOrganizationDeadlineAction({
					organizationId: orgId,
					contractEndDate: dateValue || null,
				});
				flash('Deadline bijgewerkt');
				router.refresh();
			} catch (error) {
				flash(error instanceof Error ? error.message : 'Deadline bijwerken mislukt');
			}
		});
	};

	const handleAccessToggle = (orgId: string, isActive: boolean) => {
		startTransition(async () => {
			try {
				await updateOrganizationAccessAction({ organizationId: orgId, isActive });
				flash(isActive ? 'Organisatie heropend' : 'Organisatie gesloten');
				router.refresh();
			} catch (error) {
				flash(error instanceof Error ? error.message : 'Status bijwerken mislukt');
			}
		});
	};

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="text-2xl font-bold text-foreground">Platform admin</h2>
					<p className="mt-1 text-sm text-ui-muted">
						{data.organizations.length} organisaties · {data.accessKeys.length} sleutels
					</p>
				</div>
				{message && (
					<div className="animate-in fade-in rounded-xl border border-ui-accent/20 bg-ui-accent/10 px-4 py-2 text-sm text-foreground">
						{message}
					</div>
				)}
			</div>

			{/* Tabs */}
			<div className="flex gap-1 rounded-xl border border-ui-border bg-ui-panel p-1">
				<button
					onClick={() => setTab('organizations')}
					className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
						tab === 'organizations'
							? 'bg-ui-accent text-slate-900'
							: 'text-ui-muted hover:text-foreground'
					}`}
				>
					Organisaties ({data.organizations.length})
				</button>
				<button
					onClick={() => setTab('keys')}
					className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
						tab === 'keys'
							? 'bg-ui-accent text-slate-900'
							: 'text-ui-muted hover:text-foreground'
					}`}
				>
					Toegangssleutels ({data.accessKeys.length})
				</button>
			</div>

			{/* ===================== ORGANIZATIONS TAB ===================== */}
			{tab === 'organizations' && (
				<div className="space-y-3">
					<Input
						value={orgSearch}
						onChange={(e) => setOrgSearch(e.target.value)}
						placeholder="Zoek op naam, slug of gebruiker..."
						className="rounded-xl border-ui-border bg-ui-panel"
					/>

					{/* Table header */}
					<div className="hidden rounded-xl border border-ui-border bg-ui-card px-4 py-2 text-xs font-medium uppercase tracking-wide text-ui-muted sm:grid sm:grid-cols-[1fr_100px_100px_90px_110px_80px]">
						<span>Organisatie</span>
						<span className="text-center">Status</span>
						<span className="text-center">Plan</span>
						<span className="text-center">STL</span>
						<span className="text-center">Deadline</span>
						<span className="text-center">Gebruikers</span>
					</div>

					{filteredOrgs.length === 0 && (
						<p className="py-8 text-center text-sm text-ui-muted">Geen organisaties gevonden.</p>
					)}

					{filteredOrgs.map((org) => {
						const isExpanded = expandedOrgId === org.id;
						return (
							<div key={org.id} className="rounded-xl border border-ui-border bg-ui-panel transition-colors hover:border-ui-accent/30">
								{/* Row */}
								<button
									onClick={() => setExpandedOrgId(isExpanded ? null : org.id)}
									className="w-full px-4 py-3 text-left sm:grid sm:grid-cols-[1fr_100px_100px_90px_110px_80px] sm:items-center"
								>
									<div className="flex items-center gap-2">
										<span className="font-semibold text-foreground">{org.name}</span>
										<span className="text-xs text-ui-muted">/{org.slug}</span>
									</div>
									<div className="text-center"><StatusBadge active={org.isActive} /></div>
									<p className="text-center text-sm text-foreground">{formatPlanLabel(org.plan)}</p>
									<p className="text-center text-sm text-foreground">{org.stlUsage}/{org.stlLimit}</p>
									<p className="text-center text-xs text-ui-muted">{formatDate(org.contractEndDate)}</p>
									<p className="text-center text-sm text-foreground">{org.users.length}</p>
								</button>

								{/* Expanded detail */}
								{isExpanded && (
									<div className="border-t border-ui-border px-4 pb-4 pt-3">
										<div className="grid gap-4 lg:grid-cols-3">
											{/* Plan & deadline controls */}
											<div className="space-y-3 rounded-xl border border-ui-border bg-ui-card p-4">
												<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Plan beheren</p>
												<OrgPlanEditor
													org={org}
													isPending={isPending}
													onUpdate={handlePlanUpdate}
												/>

												<div className="space-y-1.5">
													<p className="text-xs uppercase tracking-wide text-ui-text/70">Deadline contract</p>
													<OrgDeadlinePicker
														orgId={org.id}
														contractEndDate={org.contractEndDate}
														isPending={isPending}
														onUpdate={handleDeadlineUpdate}
													/>
												</div>

												<div className="flex items-center justify-between gap-3 rounded-lg border border-ui-border bg-ui-panel px-3 py-2">
													<p className="text-sm text-foreground">
														{org.isActive ? 'Bedrijf is actief' : 'Bedrijf is gesloten'}
													</p>
													<Button
														onClick={() => handleAccessToggle(org.id, !org.isActive)}
														disabled={isPending}
														variant="outline"
														className="rounded-lg text-xs"
													>
														{org.isActive ? 'Sluiten' : 'Heropenen'}
													</Button>
												</div>
												{org.closedAt && (
													<p className="text-xs text-red-400">
														Gesloten op {formatDate(org.closedAt)}
														{org.closedReason ? ` — ${org.closedReason}` : ''}
													</p>
												)}
											</div>

											{/* Usage summary */}
											<div className="space-y-3 rounded-xl border border-ui-border bg-ui-card p-4">
												<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Gebruik</p>
												<div className="grid grid-cols-2 gap-2">
													{Object.entries(org.usageSummary).map(([eventType, count]) => (
														<div key={eventType} className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2">
															<p className="text-[11px] text-ui-muted">{USAGE_EVENT_LABELS[eventType as keyof typeof USAGE_EVENT_LABELS]}</p>
															<p className="text-sm font-semibold text-foreground">{count}</p>
														</div>
													))}
												</div>
												<div className="grid grid-cols-2 gap-2 text-sm">
													<div className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2">
														<p className="text-[11px] text-ui-muted">Projecten</p>
														<p className="font-semibold text-foreground">{org.projectCount}</p>
													</div>
													<div className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2">
														<p className="text-[11px] text-ui-muted">Ontwerpen</p>
														<p className="font-semibold text-foreground">{org.designCount}</p>
													</div>
												</div>
											</div>

											{/* Users */}
											<div className="space-y-3 rounded-xl border border-ui-border bg-ui-card p-4">
												<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">
													Gebruikers ({org.users.length})
												</p>
												<div className="max-h-60 space-y-2 overflow-y-auto">
													{org.userUsage.map((user) => (
														<div key={user.id} className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2">
															<div className="flex items-center justify-between gap-2">
																<div className="min-w-0">
																	<p className="truncate text-sm font-medium text-foreground">{user.name}</p>
																	<p className="truncate text-xs text-ui-muted">{user.email}</p>
																</div>
																<span className="shrink-0 rounded-full bg-ui-accent/10 px-2 py-0.5 text-[10px] font-medium text-ui-accent">
																	{user.role}
																</span>
															</div>
															{user.usageSummary && (
																<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ui-muted">
																	{Object.entries(user.usageSummary).map(([et, c]) => (
																		<span key={et}>{USAGE_EVENT_LABELS[et as keyof typeof USAGE_EVENT_LABELS]}: <span className="font-semibold text-foreground">{c}</span></span>
																	))}
																</div>
															)}
														</div>
													))}
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* ===================== KEYS TAB ===================== */}
			{tab === 'keys' && (
				<div className="space-y-3">
					<div className="flex gap-3">
						<Input
							value={keySearch}
							onChange={(e) => setKeySearch(e.target.value)}
							placeholder="Zoek op code, label, email of organisatie..."
							className="flex-1 rounded-xl border-ui-border bg-ui-panel"
						/>
						<Button
							onClick={() => setShowNewKeyForm(!showNewKeyForm)}
							className="shrink-0 rounded-xl bg-ui-accent px-5 font-semibold text-slate-900"
						>
							{showNewKeyForm ? 'Annuleren' : '+ Nieuwe sleutel'}
						</Button>
					</div>

					{/* New key form */}
					{showNewKeyForm && (
						<div className="rounded-xl border border-ui-accent/30 bg-ui-panel p-5">
							<p className="mb-4 text-sm font-semibold text-foreground">Nieuwe toegangssleutel</p>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								<Select
									label="Plan"
									value={form.plan}
									onChange={(val) => {
										const plan = val as CompanyPlan;
										const def = PLAN_DEFINITIONS.find((d) => d.plan === plan);
										setForm((f) => ({
											...f,
											plan,
											stlLimit: isCustomPlan(plan) ? f.stlLimit : String(def?.stlLimit ?? 200),
										}));
									}}
									options={PLAN_SELECT_OPTIONS}
									size="md"
								/>
								{isCustomPlan(form.plan) && (
									<div>
										<label className="mb-1 block text-xs uppercase tracking-wide text-ui-text/70">STL limiet</label>
										<Input
											value={form.stlLimit}
											onChange={(e) => setForm((f) => ({ ...f, stlLimit: e.target.value }))}
											type="number"
											className="rounded-lg border-ui-border bg-[rgba(255,255,255,0.04)]"
										/>
									</div>
								)}
								<div>
									<label className="mb-1 block text-xs uppercase tracking-wide text-ui-text/70">Label / bedrijfsnaam</label>
									<Input
										value={form.label}
										onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
										className="rounded-lg border-ui-border bg-[rgba(255,255,255,0.04)]"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs uppercase tracking-wide text-ui-text/70">E-mailadres (optioneel)</label>
									<Input
										value={form.createdForEmail}
										onChange={(e) => setForm((f) => ({ ...f, createdForEmail: e.target.value }))}
										className="rounded-lg border-ui-border bg-[rgba(255,255,255,0.04)]"
									/>
								</div>
								<div className="sm:col-span-2 lg:col-span-1">
									<label className="mb-1 block text-xs uppercase tracking-wide text-ui-text/70">Notities</label>
									<Input
										value={form.notes}
										onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
										className="rounded-lg border-ui-border bg-[rgba(255,255,255,0.04)]"
									/>
								</div>
							</div>
							<Button
								onClick={handleCreateKey}
								disabled={isPending}
								className="mt-4 rounded-lg bg-ui-accent px-6 py-2 font-semibold text-slate-900"
							>
								{isPending ? 'Bezig...' : 'Aanmaken'}
							</Button>
						</div>
					)}

					{/* Table header */}
					<div className="hidden rounded-xl border border-ui-border bg-ui-card px-4 py-2 text-xs font-medium uppercase tracking-wide text-ui-muted sm:grid sm:grid-cols-[1fr_120px_80px_80px_100px]">
						<span>Code / Label</span>
						<span className="text-center">Plan</span>
						<span className="text-center">STL</span>
						<span className="text-center">Status</span>
						<span className="text-center">Aangemaakt</span>
					</div>

					{filteredKeys.length === 0 && (
						<p className="py-8 text-center text-sm text-ui-muted">Geen sleutels gevonden.</p>
					)}

					{filteredKeys.map((key) => {
						const isExpanded = expandedKeyId === key.id;
						return (
							<div key={key.id} className="rounded-xl border border-ui-border bg-ui-panel transition-colors hover:border-ui-accent/30">
								<button
									onClick={() => setExpandedKeyId(isExpanded ? null : key.id)}
									className="w-full px-4 py-3 text-left sm:grid sm:grid-cols-[1fr_120px_80px_80px_100px] sm:items-center"
								>
									<div>
										<CopyableCode code={key.code} />
										<p className="text-xs text-ui-muted">{key.label || 'Zonder label'}</p>
									</div>
									<p className="text-center text-sm text-foreground">{formatPlanLabel(key.plan as CompanyPlan)}</p>
									<p className="text-center text-sm text-foreground">{key.stlLimit}</p>
									<div className="text-center"><KeyStatusBadge status={key.effectiveStatus} /></div>
									<p className="text-center text-xs text-ui-muted">{formatDate(key.createdAt)}</p>
								</button>

								{isExpanded && (
									<div className="border-t border-ui-border px-4 pb-4 pt-3">
										<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
											<div className="space-y-2 text-sm">
												<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Details</p>
												<div className="space-y-1.5 text-foreground">
													<p>E-mail: <span className="text-ui-muted">{key.createdForEmail || '—'}</span></p>
													<p>Plan: <span className="text-ui-muted">{formatPlanLabel(key.plan as CompanyPlan)} · {key.stlLimit} STL</span></p>
													<p>Notities: <span className="text-ui-muted">{key.notes || '—'}</span></p>
												</div>
											</div>
											<div className="space-y-2 text-sm">
												<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Koppeling</p>
												<div className="space-y-1.5 text-foreground">
													<p>Organisatie: <span className="text-ui-muted">{key.organization?.name ?? '—'}</span></p>
													<p>Ingewisseld: <span className="text-ui-muted">{formatDate(key.redeemedAt)}</span></p>
													<p>Door: <span className="text-ui-muted">{key.redeemedBy?.name ?? '—'}</span></p>
													<p>Uitgegeven door: <span className="text-ui-muted">{key.issuedBy?.name ?? '—'}</span></p>
												</div>
											</div>
											<div className="flex items-end">
												<Button
													onClick={() => handleDeleteKey(key.id)}
													disabled={isPending}
													variant="outline"
													className="rounded-lg border-red-500/30 text-red-400 hover:bg-red-500/10"
												>
													Sleutel verwijderen
												</Button>
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

/* ─── Sub-component: Copyable key code ─── */

function CopyableCode({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [code]);

	return (
		<span
			onClick={handleCopy}
			title="Klik om te kopiëren"
			className="group/code inline-flex cursor-copy items-center gap-1.5 font-mono text-sm font-semibold text-foreground transition-colors hover:text-ui-accent"
		>
			{code}
			{copied ? (
				<Check size={13} className="shrink-0 text-emerald-400" />
			) : (
				<Copy size={13} className="shrink-0 text-ui-muted/50 transition-colors group-hover/code:text-ui-accent" />
			)}
		</span>
	);
}

/* ─── Sub-component: Inline plan editor for an org ─── */

function OrgPlanEditor({
	org,
	isPending,
	onUpdate,
}: {
	org: PlatformDashboardData['organizations'][number];
	isPending: boolean;
	onUpdate: (orgId: string, plan: CompanyPlan, stlLimit: number) => void;
}) {
	const [editPlan, setEditPlan] = useState<CompanyPlan>(org.plan);
	const [editLimit, setEditLimit] = useState(String(org.stlLimit));

	const handlePlanChange = (val: string) => {
		const plan = val as CompanyPlan;
		setEditPlan(plan);
		if (!isCustomPlan(plan)) {
			const def = PLAN_DEFINITIONS.find((d) => d.plan === plan);
			if (def) {
				setEditLimit(String(def.stlLimit));
				onUpdate(org.id, plan, def.stlLimit);
			}
		}
	};

	return (
		<div className="space-y-2">
			<Select
				value={editPlan}
				onChange={handlePlanChange}
				options={PLAN_SELECT_OPTIONS}
				size="sm"
			/>
			{isCustomPlan(editPlan) && (
				<Input
					type="number"
					value={editLimit}
					onChange={(e) => setEditLimit(e.target.value)}
					onBlur={() => onUpdate(org.id, editPlan, Number(editLimit))}
					placeholder="STL limiet"
					className="rounded-lg border-ui-border bg-[rgba(255,255,255,0.04)] text-sm"
				/>
			)}
		</div>
	);
}

/* ─── Sub-component: Deadline date picker for an org ─── */

function OrgDeadlinePicker({
	orgId,
	contractEndDate,
	isPending,
	onUpdate,
}: {
	orgId: string;
	contractEndDate: Date | string | null | undefined;
	isPending: boolean;
	onUpdate: (orgId: string, dateValue: string) => void;
}) {
	const [localDate, setLocalDate] = useState(() => toDateInputValue(contractEndDate));

	return (
		<div className="flex items-center gap-2">
			<input
				type="date"
				value={localDate}
				onChange={(e) => setLocalDate(e.target.value)}
				className="flex-1 rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-ui-text transition-colors hover:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 [color-scheme:dark]"
			/>
			<Button
				onClick={() => onUpdate(orgId, localDate)}
				disabled={isPending || localDate === toDateInputValue(contractEndDate)}
				variant="outline"
				className="shrink-0 rounded-lg text-xs"
			>
				Opslaan
			</Button>
		</div>
	);
}
