import type { Metadata } from 'next';
import Link from 'next/link';
import { getPatient } from '@/src/features/patients/server/actions';
import { ArrowLeft, FolderOpen } from 'lucide-react';
import { PatientActions } from '@/src/features/patients/components/PatientActions';
import { notFound } from 'next/navigation';

interface PatientDetailPageProps {
	params: Promise<{ orgSlug: string; id: string }>;
}

export async function generateMetadata({
	params,
}: PatientDetailPageProps): Promise<Metadata> {
	const { id } = await params;
	try {
		const patient = await getPatient(id);
		return {
			title: `${patient.firstName} ${patient.lastName}`,
			description: `Patiëntdossier van ${patient.firstName} ${patient.lastName} – projecten en gegevens.`,
		};
	} catch {
		return { title: 'Patiënt' };
	}
}

export default async function PatientDetailPage({
	params,
}: PatientDetailPageProps) {
	const { orgSlug, id } = await params;

	let patient;
	try {
		patient = await getPatient(id);
	} catch {
		notFound();
	}

	if (!patient) {
		notFound();
	}

	const patientName = `${patient.firstName} ${patient.lastName}`;

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">
				{/* Header */}
				<div className="mb-8">
					<Link
						href={`/${orgSlug}/patients`}
						className="mb-6 inline-flex items-center gap-2 text-sm text-ui-muted transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
						Terug naar patiënten
					</Link>
					<div className="flex items-start justify-between">
						<div className="flex items-center gap-6">
							<div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-linear-to-br from-ui-accent/20 to-ui-accent/5 text-2xl font-bold text-ui-accent">
								{patient.firstName[0]}
								{patient.lastName[0]}
							</div>
							<div>
								<h1 className="text-3xl font-bold text-foreground">
									{patientName}
								</h1>
								{patient.birthDate && (
									<p className="mt-2 text-ui-muted">
										Geboortedatum:{' '}
										{new Date(patient.birthDate).toLocaleDateString('nl-NL')}
									</p>
								)}
							</div>
						</div>
						<PatientActions
							patientId={id}
							patientName={patientName}
							orgSlug={orgSlug}
							currentFirstName={patient.firstName}
							currentLastName={patient.lastName}
							currentBirthDate={patient.birthDate}
							currentNotes={patient.notes}
						/>
					</div>
				</div>

				<div className="grid gap-8 lg:grid-cols-3">
					{/* Patient info */}
					<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6 lg:col-span-1">
						<h2 className="mb-6 text-xl font-semibold text-foreground">
							Patiëntgegevens
						</h2>
						<div className="space-y-6">
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Naam
								</p>
								<p className="text-foreground">{patientName}</p>
							</div>
							{patient.birthDate && (
								<div>
									<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
										Geboortedatum
									</p>
									<p className="text-foreground">
										{new Date(patient.birthDate).toLocaleDateString('nl-NL')}
									</p>
								</div>
							)}
							{patient.notes && (
								<div>
									<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
										Notities
									</p>
									<p className="rounded-xl bg-ui-overlay/30 p-4 text-sm text-foreground">
										{patient.notes}
									</p>
								</div>
							)}
							<div>
								<p className="mb-2 text-xs font-medium uppercase tracking-wide text-ui-muted">
									Aangemaakt op
								</p>
								<p className="text-foreground">
									{new Date(patient.createdAt).toLocaleDateString('nl-NL')}
								</p>
							</div>
						</div>
					</div>

					{/* Projects */}
					<div className="rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6 lg:col-span-2">
						<h2 className="mb-6 text-xl font-semibold text-foreground">
							Projecten ({patient.projects.length})
						</h2>
						{patient.projects.length === 0 ? (
							<div className="flex flex-col items-center justify-center rounded-xl bg-ui-overlay/30 py-12">
								<div className="mb-4 rounded-full bg-ui-overlay p-4">
									<FolderOpen className="h-8 w-8 text-ui-muted" />
								</div>
								<p className="text-center text-ui-muted">
									Nog geen projecten voor deze patiënt.
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{patient.projects.map((project) => (
									<Link
										key={project.id}
										href={`/${orgSlug}/projects/${project.id}`}
										className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-overlay/20 p-4 transition-all hover:border-ui-accent/50 hover:bg-ui-overlay/40"
									>
										<div>
											<p className="font-semibold text-foreground">
												{project.name}
											</p>
											<p className="mt-1 text-sm text-ui-muted">
												{project.doctor?.name || 'Geen behandelaar'} •{' '}
												{new Date(project.date).toLocaleDateString('nl-NL')}
											</p>
										</div>
										<span
											className={`rounded-xl px-4 py-2 text-xs font-medium ${
												project.status === 'COMPLETED'
													? 'bg-green-500/10 text-green-400'
													: project.status === 'IN_PROGRESS'
														? 'bg-blue-500/10 text-blue-400'
														: 'bg-ui-overlay text-ui-muted'
											}`}
										>
											{project.status === 'COMPLETED'
												? 'Voltooid'
												: project.status === 'IN_PROGRESS'
													? 'In behandeling'
													: project.status === 'DRAFT'
														? 'Concept'
														: 'Gearchiveerd'}
										</span>
									</Link>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
