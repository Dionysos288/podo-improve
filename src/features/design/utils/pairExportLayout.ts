import * as THREE from 'three';

/** STL download: left/right insoles separated along export X (length). */
export type PairExportLayout = 'side-by-side' | 'print-bed';

/** @deprecated Use `side-by-side` / `print-bed` instead. */
export type LegacyPairExportLayout = 'visual' | 'compact';

export function normalizePairExportLayout(
	layout: PairExportLayout | LegacyPairExportLayout = 'side-by-side',
): PairExportLayout {
	if (layout === 'visual' || layout === 'side-by-side') return 'side-by-side';
	return 'print-bed';
}

/**
 * Space a centred left/right export pair so they do not overlap.
 *
 * - `side-by-side`: separate along X (length) for STL viewers.
 * - `print-bed`: separate along Y (width) so the pair fits on the printer bed.
 */
export function applyPairExportLayout(
	left: THREE.BufferGeometry,
	right: THREE.BufferGeometry,
	spacingMm: number,
	layout: PairExportLayout | LegacyPairExportLayout = 'side-by-side',
): boolean {
	const mode = normalizePairExportLayout(layout);
	left.computeBoundingBox();
	right.computeBoundingBox();
	const leftBox = left.boundingBox;
	const rightBox = right.boundingBox;
	if (!leftBox || !rightBox) return false;

	if (mode === 'side-by-side') {
		const leftShift = -(leftBox.max.x + spacingMm * 0.5);
		const rightShift = -(rightBox.min.x - spacingMm * 0.5);
		left.applyMatrix4(new THREE.Matrix4().makeTranslation(leftShift, 0, 0));
		right.applyMatrix4(new THREE.Matrix4().makeTranslation(rightShift, 0, 0));
	} else {
		const leftShift = -(leftBox.max.y + spacingMm * 0.5);
		const rightShift = -(rightBox.min.y - spacingMm * 0.5);
		left.applyMatrix4(new THREE.Matrix4().makeTranslation(0, leftShift, 0));
		right.applyMatrix4(new THREE.Matrix4().makeTranslation(0, rightShift, 0));
	}

	return true;
}

export function pairExportGapMm(
	left: THREE.BufferGeometry,
	right: THREE.BufferGeometry,
	axis: 'x' | 'y',
): number {
	left.computeBoundingBox();
	right.computeBoundingBox();
	const leftBox = left.boundingBox;
	const rightBox = right.boundingBox;
	if (!leftBox || !rightBox) return 0;

	if (axis === 'x') {
		const leftMax = Math.max(leftBox.min.x, leftBox.max.x);
		const rightMin = Math.min(rightBox.min.x, rightBox.max.x);
		return rightMin - leftMax;
	}

	const leftMax = Math.max(leftBox.min.y, leftBox.max.y);
	const rightMin = Math.min(rightBox.min.y, rightBox.max.y);
	return rightMin - leftMax;
}
