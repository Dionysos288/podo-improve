export type CompanyPlan = 'STL200' | 'STL400' | 'STL750' | 'CUSTOM';

export type PlanDefinition = {
	plan: CompanyPlan;
	label: string;
	description: string;
	stlLimit: number;
};

export const PLAN_DEFINITIONS: PlanDefinition[] = [
	{
		plan: 'STL200',
		label: '200 STL',
		description: 'Tot 200 STL-bestanden per organisatie',
		stlLimit: 200,
	},
	{
		plan: 'STL400',
		label: '400 STL',
		description: 'Tot 400 STL-bestanden per organisatie',
		stlLimit: 400,
	},
	{
		plan: 'STL750',
		label: '750 STL',
		description: 'Tot 750 STL-bestanden per organisatie',
		stlLimit: 750,
	},
	{
		plan: 'CUSTOM',
		label: 'Aangepast',
		description: 'Handmatig ingestelde limiet door platform admin',
		stlLimit: 200,
	},
];

export function getPlanDefinition(plan: CompanyPlan): PlanDefinition {
	return PLAN_DEFINITIONS.find((entry) => entry.plan === plan) ?? PLAN_DEFINITIONS[0];
}

export function isCustomPlan(plan: CompanyPlan) {
	return plan === 'CUSTOM';
}

export function normalizeStlLimit(plan: CompanyPlan, requestedLimit?: number | null) {
	if (plan === 'CUSTOM') {
		return Math.max(1, Number(requestedLimit ?? 200));
	}
	return getPlanDefinition(plan).stlLimit;
}

export function formatPlanLabel(plan: CompanyPlan) {
	return getPlanDefinition(plan).label;
}
