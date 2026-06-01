import type { Metadata } from 'next';
import { after } from 'next/server';
import { DesignPageClient } from './DesignPageClient';
import { recordUsageEvent } from '@/src/shared/core/platform/usage';
import {
	getDesignPageViewModel,
	getDesignProjectMetadata,
} from '@/src/features/design/server/get-design-page-view-model';

interface DesignPageProps {
	params: Promise<{ orgSlug: string; projectId: string }>;
	searchParams: Promise<{ designId?: string }>;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ orgSlug: string; projectId: string }>;
}): Promise<Metadata> {
	const { projectId } = await params;
	const project = await getDesignProjectMetadata(projectId);
	return {
		title: project ? `Ontwerp – ${project.name}` : 'Ontwerp',
		description: project
			? `Ontwerp de medische inlegzool voor project "${project.name}" in de PodoImprove editor.`
			: 'PodoImprove zolenontwerp editor.',
	};
}

export default async function DesignPage({ params, searchParams }: DesignPageProps) {
	const { clientProps, usageEvent } = await getDesignPageViewModel({
		params,
		searchParams,
	});

	after(async () => {
		try {
			await recordUsageEvent(usageEvent);
		} catch (error) {
			console.error('Failed to record design open usage event:', error);
		}
	});

	return <DesignPageClient {...clientProps} />;
}
