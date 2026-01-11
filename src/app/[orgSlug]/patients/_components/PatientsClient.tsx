'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Plus, Search, User } from 'lucide-react';
import { CreatePatientModal } from './CreatePatientModal';

interface Patient {
	id: string;
	firstName: string;
	lastName: string;
	birthDate: Date | null;
	notes: string | null;
	createdAt: Date;
	projectsCount: number;
}

interface PatientsClientProps {
	patients: Patient[];
	orgSlug: string;
}

export function PatientsClient({ patients, orgSlug }: PatientsClientProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [showCreateModal, setShowCreateModal] = useState(false);

	const filteredPatients = patients.filter((patient) => {
		const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
		return fullName.includes(searchQuery.toLowerCase());
	});

	return (
		<>
			<div className="mb-8 flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold text-foreground">Patiënten</h1>
					<p className="mt-2 text-ui-muted">
						Beheer je patiënten en hun projecten
					</p>
				</div>
				<Button
					onClick={() => setShowCreateModal(true)}
					className="flex items-center gap-2 rounded-xl bg-ui-accent px-5 py-2.5 font-medium text-slate-900 transition-colors"
				>
					<Plus className="h-5 w-5" />
					Nieuwe patiënt
				</Button>
			</div>

			{/* Search */}
			<div className="relative mb-8">
				<Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ui-muted" />
				<Input
					type="text"
					placeholder="Zoek patiënten..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="w-full rounded-xl border border-ui-border bg-ui-card py-3 pl-12 pr-4 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
				/>
			</div>

			{/* Patients list */}
			{filteredPatients.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-2xl border border-ui-border bg-ui-card p-12">
					<div className="mb-4 rounded-full bg-ui-overlay p-4">
						<User className="h-8 w-8 text-ui-muted" />
					</div>
					<p className="text-center text-ui-muted">
						{searchQuery
							? 'Geen patiënten gevonden'
							: 'Nog geen patiënten. Voeg je eerste patiënt toe.'}
					</p>
				</div>
			) : (
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{filteredPatients.map((patient) => (
						<Link key={patient.id} href={`/${orgSlug}/patients/${patient.id}`}>
							<div className="group h-full rounded-2xl border border-ui-border bg-linear-to-br from-ui-card to-ui-panel p-6 transition-all hover:border-ui-accent/50 hover:shadow-lg hover:shadow-ui-accent/5">
								<div className="mb-4 flex items-center gap-4">
									<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ui-accent/10 text-lg font-semibold text-ui-accent">
										{patient.firstName[0]}
										{patient.lastName[0]}
									</div>
									<div className="min-w-0 flex-1">
										<h3 className="truncate text-lg font-semibold text-foreground">
											{patient.firstName} {patient.lastName}
										</h3>
										{patient.birthDate && (
											<p className="text-sm text-ui-muted">
												{new Date(patient.birthDate).toLocaleDateString(
													'nl-NL'
												)}
											</p>
										)}
									</div>
								</div>
								<div className="flex items-center justify-between rounded-xl bg-ui-overlay/30 px-4 py-3 text-sm">
									<span className="text-ui-muted">
										{patient.projectsCount} project
										{patient.projectsCount !== 1 ? 'en' : ''}
									</span>
									<span className="text-ui-muted">
										{new Date(patient.createdAt).toLocaleDateString('nl-NL')}
									</span>
								</div>
							</div>
						</Link>
					))}
				</div>
			)}

			<CreatePatientModal
				open={showCreateModal}
				onClose={() => setShowCreateModal(false)}
			/>
		</>
	);
}
