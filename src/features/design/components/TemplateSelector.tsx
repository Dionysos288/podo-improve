'use client';

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import type { InsoleTemplate } from '@/src/features/design/types/types';
import { useState } from 'react';

const INSOLE_TEMPLATES: Array<{
	id: InsoleTemplate;
	name: string;
	icon: string;
}> = [
	{ id: 'classic', name: 'Classic', icon: '👟' },
	{ id: 'dunes', name: 'Dunes', icon: '🏜️' },
	{ id: 'finncomfort', name: 'FinnComfort', icon: '🦶' },
	{ id: 'man', name: 'Man', icon: '👨' },
	{ id: 'woman', name: 'Woman', icon: '👩' },
	{ id: '3quarter', name: '3/4 Sole', icon: '👣' },
] as const;

interface TemplateSelectorProps {
	onSelect: () => void;
}

export function TemplateSelector({ onSelect }: TemplateSelectorProps) {
	const [selectedTemplate, setSelectedTemplate] =
		useState<InsoleTemplate | null>(null);
	const { setSelectedTemplate: setStoreTemplate } = useDesignStore();

	const handleSelect = (template: InsoleTemplate) => {
		setSelectedTemplate(template);
		setStoreTemplate(template);
	};

	const handleContinue = () => {
		if (selectedTemplate) {
			onSelect();
		}
	};

	return (
		<div className="w-full max-w-4xl mx-auto">
			<Card>
				<CardHeader>
					<CardTitle className="text-2xl">Select Insole Template</CardTitle>
					<p className="text-gray-600 mt-2">
						Choose an insole template to begin designing
					</p>
				</CardHeader>
				<CardContent>
					{/* Template Grid */}
					<div className="grid grid-cols-3 gap-4 mb-6">
						{INSOLE_TEMPLATES.map((template) => (
							<button
								key={template.id}
								onClick={() => handleSelect(template.id)}
								className={`
									p-6 rounded-lg border-2 transition-all
									${
										selectedTemplate === template.id
											? 'border-green-500 bg-green-50 shadow-lg scale-105'
											: 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
									}
								`}
							>
								<div className="text-4xl mb-2">{template.icon}</div>
								<div className="font-medium text-lg">{template.name}</div>
							</button>
						))}
					</div>

					{/* Continue Button */}
					<div className="flex justify-end">
						<Button
							size="lg"
							onClick={handleContinue}
							disabled={!selectedTemplate}
							className="min-w-32"
						>
							Continue →
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
