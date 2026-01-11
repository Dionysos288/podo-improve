import { tv } from '@/src/shared/lib/tv';

const DEFAULT_STEPS: Array<{ id: number; label: string }> = [
	{ id: 1, label: 'Basis' },
	{ id: 2, label: 'Ontwerp' },
	{ id: 3, label: 'Printen' },
	{ id: 4, label: 'Export' },
];

const tabStyles = tv({
	base: 'flex-1  border-b border-r border-ui-border px-3 py-3 text-sm font-semibold transition',
	variants: {
		active: {
			true: 'border-b-transparent bg-ui-panel text-ui-text ',
			false: ' bg-background text-ui-muted hover:text-ui-text',
		},
	},
});

interface StepRailProps {
	activeStep: number;
	onStepChange: (step: number) => void;
	/** Override default step labels by step id */
	stepLabels?: Partial<Record<number, string>>;
}

export function StepRail({
	activeStep,
	onStepChange,
	stepLabels,
}: StepRailProps) {
	const steps = DEFAULT_STEPS.map((step) => ({
		...step,
		label: stepLabels?.[step.id] ?? step.label,
	}));

	return (
		<div className="flex ">
			{steps.map((step) => (
				<button
					type="button"
					key={step.id}
					className={tabStyles({ active: activeStep === step.id })}
					style={step.id === 4 ? { borderRight: '0px' } : undefined}
					onClick={() => onStepChange(step.id)}
				>
					{step.label}
				</button>
			))}
		</div>
	);
}
