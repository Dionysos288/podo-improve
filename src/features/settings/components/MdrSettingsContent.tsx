'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useOrgSettings, useUpdateOrgSettings } from '@/src/features/settings/hooks/use-settings';
import type { OrgSettings } from '@/src/features/settings/types/settings';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { SectionCard, SectionHeader } from '@/src/shared/components/ui/section-card';
import { cn } from '@/src/shared/lib/cn';

const inputClassName =
	'flex w-full rounded-lg border border-ui-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-foreground placeholder:text-ui-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/40 disabled:opacity-50';

function EditableField({
	label,
	value,
	onChange,
	hint,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	hint?: string;
}) {
	return (
		<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
			<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">{label}</label>
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Invullen…"
				className={cn('mt-2 h-9', inputClassName)}
			/>
			{hint ? <p className="mt-1 text-xs text-ui-muted">{hint}</p> : null}
		</div>
	);
}

function EditableTextarea({
	label,
	value,
	onChange,
	rows = 4,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
}) {
	return (
		<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
			<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">{label}</label>
			<textarea
				value={value}
				onChange={(e) => onChange(e.target.value)}
				rows={rows}
				placeholder="Invullen…"
				className={cn('mt-2 min-h-[80px] resize-y', inputClassName)}
			/>
		</div>
	);
}

type MdrFormState = {
	companyName: string;
	companyAddress: string;
	introParagraph: string;
	outroParagraph: string;
	disclaimerParagraph: string;
	manufacturer: string;
	prrc: string;
	kvkVat: string;
	vigilanceContact: string;
};

function settingsToForm(settings: OrgSettings): MdrFormState {
	const mdr = settings.mdr ?? {};
	return {
		companyName: settings.companyName ?? '',
		companyAddress: settings.companyAddress ?? '',
		introParagraph: settings.introParagraph ?? '',
		outroParagraph: settings.outroParagraph ?? '',
		disclaimerParagraph: settings.disclaimerParagraph ?? '',
		manufacturer: mdr.manufacturer ?? '',
		prrc: mdr.prrc ?? '',
		kvkVat: mdr.kvkVat ?? '',
		vigilanceContact: mdr.vigilanceContact ?? '',
	};
}

function formToPatch(form: MdrFormState, existing: OrgSettings): OrgSettings {
	return {
		...existing,
		companyName: form.companyName.trim() || undefined,
		companyAddress: form.companyAddress.trim() || undefined,
		introParagraph: form.introParagraph.trim() || undefined,
		outroParagraph: form.outroParagraph.trim() || undefined,
		disclaimerParagraph: form.disclaimerParagraph.trim() || undefined,
		mdr: {
			...(existing.mdr ?? {}),
			manufacturer: form.manufacturer.trim() || undefined,
			prrc: form.prrc.trim() || undefined,
			kvkVat: form.kvkVat.trim() || undefined,
			vigilanceContact: form.vigilanceContact.trim() || undefined,
		},
	};
}

export function MdrSettingsContent() {
	const { data: settings, isLoading } = useOrgSettings();
	const updateSettings = useUpdateOrgSettings();
	const [form, setForm] = useState<MdrFormState | null>(null);
	const [saved, setSaved] = useState(false);
	const [showOrgFields, setShowOrgFields] = useState(false);

	useEffect(() => {
		if (settings && form === null) {
			setForm(settingsToForm(settings));
		}
	}, [settings, form]);

	const patchField = <K extends keyof MdrFormState>(key: K, value: MdrFormState[K]) => {
		setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
		setSaved(false);
	};

	const handleSave = () => {
		if (!form || !settings) return;
		updateSettings.mutate(formToPatch(form, settings), {
			onSuccess: (next) => {
				setForm(settingsToForm(next));
				setSaved(true);
			},
		});
	};

	if (isLoading || !form) {
		return (
			<div className="flex items-center justify-center py-16 text-sm text-ui-muted">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				MDR-gegevens laden…
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-ui-border bg-ui-panel p-6">
				<div>
					<h2 className="text-xl font-semibold text-foreground">MDR &amp; regelgeving</h2>
					<p className="mt-2 max-w-2xl text-sm text-ui-muted">
						Maatwerk voetorthosen vallen onder EU 2017/745 (Bijlage XIII). Bewaar hier uw
						organisatiegegevens en standaardteksten voor Annex XIII-verklaringen.
					</p>
				</div>
				<Button
					className="bg-ui-accent text-slate-900 hover:opacity-90"
					onClick={handleSave}
					disabled={updateSettings.isPending}
				>
					{updateSettings.isPending ? (
						<span className="inline-flex items-center gap-2">
							<Loader2 className="h-4 w-4 animate-spin" />
							Opslaan…
						</span>
					) : saved ? (
						'Opgeslagen'
					) : (
						'Opslaan'
					)}
				</Button>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Regelgeving</p>
					<p className="mt-2 text-sm text-foreground">EU 2017/745 (MDR)</p>
				</div>
				<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Type product</p>
					<p className="mt-2 text-sm text-foreground">Maatwerk (CMD)</p>
				</div>
				<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Classificatie</p>
					<p className="mt-2 text-sm text-foreground">Klasse I (typisch)</p>
				</div>
				<div className="rounded-xl border border-ui-border bg-ui-panel px-4 py-3">
					<p className="text-xs font-medium uppercase tracking-wide text-ui-muted">Route</p>
					<p className="mt-2 text-sm text-foreground">Bijlage XIII</p>
				</div>
			</div>

			<SectionCard>
				<SectionHeader
					title="Annex XIII — standaardteksten"
					description="Bedrijfsgegevens en vaste teksten voor uw MDR-verklaringen"
				/>
				<div className="grid gap-3 sm:grid-cols-2">
					<EditableField
						label="Bedrijfsnaam"
						value={form.companyName}
						onChange={(v) => patchField('companyName', v)}
					/>
					<EditableField
						label="Adres"
						value={form.companyAddress}
						onChange={(v) => patchField('companyAddress', v)}
					/>
				</div>
				<div className="mt-4 space-y-3">
					<EditableTextarea
						label="Introductie"
						value={form.introParagraph}
						onChange={(v) => patchField('introParagraph', v)}
						rows={3}
					/>
					<EditableTextarea
						label="Afsluiting"
						value={form.outroParagraph}
						onChange={(v) => patchField('outroParagraph', v)}
						rows={3}
					/>
					<EditableTextarea
						label="Disclaimer"
						value={form.disclaimerParagraph}
						onChange={(v) => patchField('disclaimerParagraph', v)}
						rows={3}
					/>
				</div>
			</SectionCard>

			<SectionCard>
				<button
					type="button"
					onClick={() => setShowOrgFields((v) => !v)}
					className="flex w-full items-center justify-between text-left"
				>
					<SectionHeader
						title="Organisatiegegevens (optioneel)"
						description="Fabrikant, PRRC en contact — voor interne documentatie"
					/>
					<span className="text-sm text-ui-muted">{showOrgFields ? 'Verbergen' : 'Tonen'}</span>
				</button>
				{showOrgFields ? (
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						<EditableField
							label="Fabrikant"
							value={form.manufacturer}
							onChange={(v) => patchField('manufacturer', v)}
						/>
						<EditableField
							label="PRRC"
							value={form.prrc}
							onChange={(v) => patchField('prrc', v)}
						/>
						<EditableField
							label="KvK / BTW"
							value={form.kvkVat}
							onChange={(v) => patchField('kvkVat', v)}
						/>
						<EditableField
							label="Contact vigilance / klachten"
							value={form.vigilanceContact}
							onChange={(v) => patchField('vigilanceContact', v)}
						/>
					</div>
				) : null}
			</SectionCard>
		</div>
	);
}
