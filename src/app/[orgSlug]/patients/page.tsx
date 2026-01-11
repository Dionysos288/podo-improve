import { getPatients } from '@/src/features/patients/server/actions';
import { PatientsClient } from '@/src/features/patients/components/PatientsClient';

interface PatientsPageProps {
	params: Promise<{ orgSlug: string }>;
}

export default async function PatientsPage({ params }: PatientsPageProps) {
	const { orgSlug } = await params;
	const patients = await getPatients();

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="mx-auto max-w-7xl">
				<PatientsClient patients={patients} orgSlug={orgSlug} />
			</div>
		</div>
	);
}
