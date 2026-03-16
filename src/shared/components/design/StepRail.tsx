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
	/** Step IDs that are visible. If omitted, all steps are shown. */
	visibleSteps?: number[];
}

export function StepRail({
	activeStep,
	onStepChange,
	stepLabels,
	visibleSteps,
}: StepRailProps) {
	const steps = DEFAULT_STEPS
		.filter((step) => !visibleSteps || visibleSteps.includes(step.id))
		.map((step) => ({
			...step,
			label: stepLabels?.[step.id] ?? step.label,
		}));

	return (
		<div className="flex ">
			{steps.map((step, idx) => (
				<button
					type="button"
					key={step.id}
					className={tabStyles({ active: activeStep === step.id })}
					style={idx === steps.length - 1 ? { borderRight: '0px' } : undefined}
					onClick={() => onStepChange(step.id)}
				>
					{step.label}
				</button>
			))}
		</div>
	);
}
