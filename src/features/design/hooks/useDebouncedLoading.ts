'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Delays showing a loading state and enforces a minimum visible time to avoid UI flashes.
 */
export function useDebouncedLoading(
	active: boolean,
	enterDelayMs = 150,
	minVisibleMs = 200,
): boolean {
	const [displayed, setDisplayed] = useState(false);
	const shownAtRef = useRef<number | null>(null);

	useEffect(() => {
		let enterTimer: ReturnType<typeof setTimeout> | undefined;
		let exitTimer: ReturnType<typeof setTimeout> | undefined;

		if (active) {
			enterTimer = setTimeout(() => {
				shownAtRef.current = Date.now();
				setDisplayed(true);
			}, enterDelayMs);
		} else {
			const started = shownAtRef.current;
			const wait =
				started == null ? 0 : Math.max(0, minVisibleMs - (Date.now() - started));
			exitTimer = setTimeout(() => {
				shownAtRef.current = null;
				setDisplayed(false);
			}, wait);
		}

		return () => {
			if (enterTimer) clearTimeout(enterTimer);
			if (exitTimer) clearTimeout(exitTimer);
		};
	}, [active, enterDelayMs, minVisibleMs]);

	return displayed;
}
