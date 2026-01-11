/**
 * 3D/CAD related types
 */

export type InsoleTemplate =
	| 'classic'
	| 'dunes'
	| 'finncomfort'
	| 'man'
	| 'woman'
	| '3quarter';

export type InsoleMaterial = 'eva-foam' | 'tpu-flex' | 'gel' | 'carbon-weave';

export type InsoleParameters = {
	thickness: number;
	archBoost: number;
	heelCupDepth: number;
	toeSpring: number;
	edgeLip: number;
	fitOffset: number;
	template: InsoleTemplate;
	material: InsoleMaterial;
};

export type DesignElement = {
	id: string;
	type: 'patch' | 'zone' | 'modification' | 'insole';
	position: [number, number, number];
	parameters: InsoleParameters | Record<string, unknown>;
	footSide?: 'left' | 'right';
	template?: InsoleTemplate;
};

export type DesignParameters = {
	thickness?: number;
	material?: string;
	hardness?: number;
	zones?: Array<{
		id: string;
		name: string;
		hardness: number;
		area: number[];
	}>;
};

export type MatchTransform = {
	translation: [number, number, number];
	rotation: [number, number, number];
	scale: number;
};

export const DEFAULT_INSOLE_PARAMETERS: InsoleParameters = {
	thickness: 3.2,
	archBoost: 4,
	heelCupDepth: 2.4,
	toeSpring: 1.6,
	edgeLip: 0.9,
	fitOffset: 0.6,
	template: 'classic',
	material: 'eva-foam',
};

export function isInsoleParameters(
	value: InsoleParameters | Record<string, unknown>
): value is InsoleParameters {
	return (
		typeof value === 'object' &&
		value !== null &&
		'thickness' in value &&
		'template' in value
	);
}
