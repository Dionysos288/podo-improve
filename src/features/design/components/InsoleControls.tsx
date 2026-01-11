'use client';

import { useMemo } from 'react';
import {
	DEFAULT_INSOLE_PARAMETERS,
	isInsoleParameters,
	type InsoleParameters,
	type InsoleTemplate,
} from '@/src/features/design/types/types';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Input } from '@/src/shared/components/ui/input';

const MATERIAL_OPTIONS: Array<{
	label: string;
	value: InsoleParameters['material'];
}> = [
	{ label: 'EVA foam', value: 'eva-foam' },
	{ label: 'TPU flex', value: 'tpu-flex' },
	{ label: 'Gel comfort', value: 'gel' },
	{ label: 'Carbon weave', value: 'carbon-weave' },
];

const TEMPLATE_OPTIONS: Array<{ label: string; value: InsoleTemplate }> = [
	{ label: 'Classic', value: 'classic' },
	{ label: 'Dunes', value: 'dunes' },
	{ label: 'FinnComfort', value: 'finncomfort' },
	{ label: 'Man', value: 'man' },
	{ label: 'Woman', value: 'woman' },
	{ label: '3/4 sole', value: '3quarter' },
];

export function InsoleControls() {
	const elements = useDesignStore((state) => state.elements);
	const updateElement = useDesignStore((state) => state.updateElement);
	const insoleElements = useMemo(
		() => elements.filter((element) => element.type === 'insole'),
		[elements]
	);

	if (!insoleElements.length) {
		return (
			<Card>
				<CardContent className="text-sm text-gray-500 py-6">
					Add a template to unlock insole controls.
				</CardContent>
			</Card>
		);
	}

	const handleUpdate = (id: string, patch: Partial<InsoleParameters>) => {
		const current = insoleElements.find((element) => element.id === id);
		const params =
			current && isInsoleParameters(current.parameters)
				? current.parameters
				: DEFAULT_INSOLE_PARAMETERS;

		updateElement(id, {
			parameters: { ...params, ...patch },
		});
	};

	return (
		<div className="space-y-4">
			{insoleElements.map((element) => {
				const params = isInsoleParameters(element.parameters)
					? element.parameters
					: DEFAULT_INSOLE_PARAMETERS;
				const footLabel =
					element.footSide === 'right' ? 'Right foot' : 'Left foot';

				return (
					<Card key={element.id}>
						<CardHeader className="pb-2">
							<CardTitle className="text-base">{footLabel}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4 text-sm text-gray-700">
							<label className="flex flex-col gap-1">
								<span className="font-medium text-gray-800">Template</span>
								<select
									className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
									value={params.template}
									onChange={(event) =>
										handleUpdate(element.id, {
											template: event.target.value as InsoleTemplate,
										})
									}
								>
									{TEMPLATE_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>

							<div className="grid gap-3">
								<SliderField
									label="Thickness"
									min={2}
									max={6}
									step={0.1}
									value={params.thickness}
									unit="mm"
									onChange={(value) =>
										handleUpdate(element.id, { thickness: value })
									}
								/>
								<SliderField
									label="Arch boost"
									min={0}
									max={6}
									step={0.1}
									value={params.archBoost}
									unit="mm"
									onChange={(value) =>
										handleUpdate(element.id, { archBoost: value })
									}
								/>
								<SliderField
									label="Heel cup depth"
									min={0}
									max={5}
									step={0.1}
									value={params.heelCupDepth}
									unit="mm"
									onChange={(value) =>
										handleUpdate(element.id, { heelCupDepth: value })
									}
								/>
								<SliderField
									label="Toe spring"
									min={0}
									max={4}
									step={0.1}
									value={params.toeSpring}
									unit="mm"
									onChange={(value) =>
										handleUpdate(element.id, { toeSpring: value })
									}
								/>
							</div>

							<label className="flex flex-col gap-1">
								<span className="font-medium text-gray-800">Material</span>
								<select
									className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
									value={params.material}
									onChange={(event) =>
										handleUpdate(element.id, {
											material: event.target
												.value as InsoleParameters['material'],
										})
									}
								>
									{MATERIAL_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

interface SliderFieldProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit?: string;
	onChange: (value: number) => void;
}

function SliderField({
	label,
	value,
	min,
	max,
	step,
	unit,
	onChange,
}: SliderFieldProps) {
	return (
		<label className="flex flex-col gap-1">
			<div className="flex items-center justify-between text-gray-800">
				<span className="font-medium">{label}</span>
				<span className="text-xs text-gray-500">
					{value.toFixed(1)}
					{unit ? ` ${unit}` : ''}
				</span>
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				className="w-full accent-blue-600"
			/>
			<Input
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				className="h-8 text-sm"
			/>
		</label>
	);
}
