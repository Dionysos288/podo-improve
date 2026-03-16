import type { Metadata } from 'next';
import { getSettingsUsageData } from '@/src/features/admin/server/platform-actions';
import { formatPlanLabel } from '@/src/shared/core/platform/plans';
import { USAGE_EVENT_LABELS } from '@/src/shared/core/platform/usage';

export const metadata: Metadata = {
	title: 'Gebruik & Plan',
	description: 'Bekijk uw huidig plan, STL-limieten en gebruiksactiviteit.',
};

export default async function SettingsUsagePage() {
	const data = await getSettingsUsageData();

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
				<h2 className="text-xl font-semibold text-foreground">Gebruik</h2>
				<p className="mt-2 text-sm text-ui-muted">
					Bekijk je huidige plan, STL-limiet en activiteit voor jezelf en je organisatie.
				</p>
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Plan</p>
					<p className="mt-2 text-lg font-semibold text-foreground">{formatPlanLabel(data.organization.plan)}</p>
					<p className="mt-1 text-sm text-ui-muted">{data.organization.billingStatus || 'Nog geen factuurstatus ingesteld'}</p>
				</div>
				<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">STL limiet</p>
					<p className="mt-2 text-lg font-semibold text-foreground">{data.stlUsage} / {data.organization.stlLimit}</p>
					<p className="mt-1 text-sm text-ui-muted">Actieve STL-bestanden in deze organisatie</p>
				</div>
				<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Organisatie</p>
					<p className="mt-2 text-lg font-semibold text-foreground">{data.organization.name}</p>
					<p className="mt-1 text-sm text-ui-muted">/{data.organization.slug}</p>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
					<h3 className="text-lg font-semibold text-foreground">Mijn activiteit</h3>
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						{Object.entries(data.userUsageSummary).map(([eventType, count]) => (
							<div key={eventType} className="rounded-xl border border-ui-border bg-ui-card px-4 py-3">
								<p className="text-xs uppercase tracking-wide text-ui-muted">{USAGE_EVENT_LABELS[eventType as keyof typeof USAGE_EVENT_LABELS]}</p>
								<p className="mt-2 text-lg font-semibold text-foreground">{count}</p>
							</div>
						))}
					</div>
				</div>

				<div className="rounded-2xl border border-ui-border bg-ui-panel p-6">
					<h3 className="text-lg font-semibold text-foreground">Organisatie activiteit</h3>
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						{Object.entries(data.orgUsageSummary).map(([eventType, count]) => (
							<div key={eventType} className="rounded-xl border border-ui-border bg-ui-card px-4 py-3">
								<p className="text-xs uppercase tracking-wide text-ui-muted">{USAGE_EVENT_LABELS[eventType as keyof typeof USAGE_EVENT_LABELS]}</p>
								<p className="mt-2 text-lg font-semibold text-foreground">{count}</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
