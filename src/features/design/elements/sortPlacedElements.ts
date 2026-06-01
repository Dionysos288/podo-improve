import type { PlacedElement } from './types';

/**
 * Sort elements for displacement accumulation and overlay draw order.
 * Lower `stackOrder` is applied/rendered first (underneath).
 */
export function sortPlacedElementsByStack(
	elements: PlacedElement[],
): PlacedElement[] {
	return elements
		.map((el, index) => ({ el, index }))
		.sort((a, b) => {
			const orderA = a.el.stackOrder ?? 0;
			const orderB = b.el.stackOrder ?? 0;
			if (orderA !== orderB) return orderA - orderB;
			return a.index - b.index;
		})
		.map(({ el }) => el);
}
