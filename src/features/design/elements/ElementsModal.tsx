'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { cn } from '@/src/shared/lib/cn';
import {
	ELEMENTEN_ITEMS,
	DIEPELEMENTEN_ITEMS,
	ELEMENT_COLORS,
	type ElementTab,
	type ElementLibraryItem,
} from '@/src/features/design/elements';

type Props = {
	open: boolean;
	onClose: () => void;
	onAdd: (libraryKey: string) => void;
	side: 'left' | 'right';
};

const TABS: { key: ElementTab; label: string }[] = [
	{ key: 'elementen', label: 'Elementen' },
	{ key: 'diepelementen', label: 'Diepelementen' },
];

/* ── STL silhouette thumbnail via 2D canvas ────── */

type StlSilhouette = { points: [number, number][]; w: number; h: number };
const silhouetteCache = new Map<string, StlSilhouette>();

/** Load the STL and project its vertices top-down to get a 2D silhouette */
function loadStlSilhouette(stlUrl: string): Promise<StlSilhouette | null> {
	if (silhouetteCache.has(stlUrl)) return Promise.resolve(silhouetteCache.get(stlUrl)!);

	return new Promise((resolve) => {
		const loader = new STLLoader();
		loader.load(
			stlUrl,
			(geom) => {
				geom.computeBoundingBox();
				const bb = geom.boundingBox!;
				const pos = geom.getAttribute('position');
				const count = pos.count;

				// Find which axis is height (smallest span) — project onto the other two
				const sx = bb.max.x - bb.min.x;
				const sy = bb.max.y - bb.min.y;
				const sz = bb.max.z - bb.min.z;

				// For the SD element: X=width, Y=length, Z=height → project onto X,Y
				const w = Math.max(sx, 1e-6);
				const h = Math.max(sy, 1e-6);

				// Build a grid of "is occupied" cells then trace an outline
				const GRID = 32;
				const occupied = new Uint8Array(GRID * GRID);
				for (let i = 0; i < count; i++) {
					const x = pos.getX(i);
					const y = pos.getY(i);
					const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x - bb.min.x) / w) * GRID)));
					const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y - bb.min.y) / h) * GRID)));
					occupied[gy * GRID + gx] = 1;
				}

				// Extract boundary cells (occupied with at least one empty neighbor)
				const boundary: [number, number][] = [];
				for (let gy = 0; gy < GRID; gy++) {
					for (let gx = 0; gx < GRID; gx++) {
						if (!occupied[gy * GRID + gx]) continue;
						let isBorder = gx === 0 || gx === GRID - 1 || gy === 0 || gy === GRID - 1;
						if (!isBorder) {
							for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
								if (!occupied[(gy + dy) * GRID + (gx + dx)]) { isBorder = true; break; }
							}
						}
						if (isBorder) {
							boundary.push([(gx + 0.5) / GRID, (gy + 0.5) / GRID]);
						}
					}
				}

				// Sort boundary points by angle from centroid for a clean outline
				if (boundary.length > 2) {
					let cx = 0, cy = 0;
					for (const [x, y] of boundary) { cx += x; cy += y; }
					cx /= boundary.length; cy /= boundary.length;
					boundary.sort((a, b) =>
						Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
					);
				}

				const result: StlSilhouette = { points: boundary, w, h };
				silhouetteCache.set(stlUrl, result);
				resolve(result);
			},
			undefined,
			() => resolve(null),
		);
	});
}

function ElementThumbnail({
	item,
	size = 64,
}: {
	item: ElementLibraryItem;
	size?: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const fillColor = ELEMENT_COLORS[item.color] ?? '#999';
	const [silhouette, setSilhouette] = useState<StlSilhouette | null>(
		item.stlUrl ? silhouetteCache.get(item.stlUrl) ?? null : null
	);

	// Load the STL silhouette
	useEffect(() => {
		if (!item.stlUrl) return;
		if (silhouetteCache.has(item.stlUrl)) {
			setSilhouette(silhouetteCache.get(item.stlUrl)!);
			return;
		}
		let cancelled = false;
		loadStlSilhouette(item.stlUrl).then((s) => {
			if (!cancelled && s) setSilhouette(s);
		});
		return () => { cancelled = true; };
	}, [item.stlUrl]);

	// Draw onto the 2D canvas
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = size * dpr;
		canvas.height = size * dpr;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, size, size);

		const points = silhouette?.points ?? item.outline;
		if (!points || points.length < 3) return;

		// Compute bounds of the points
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const [x, y] of points) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		const pw = Math.max(maxX - minX, 1e-6);
		const ph = Math.max(maxY - minY, 1e-6);

		// Fit into canvas with padding
		const pad = size * 0.1;
		const availW = size - pad * 2;
		const availH = size - pad * 2;
		const scale = Math.min(availW / pw, availH / ph);
		const offX = pad + (availW - pw * scale) / 2 - minX * scale;
		const offY = pad + (availH - ph * scale) / 2 - minY * scale;

		// Draw filled shape with gradient
		ctx.beginPath();
		ctx.moveTo(points[0][0] * scale + offX, points[0][1] * scale + offY);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(points[i][0] * scale + offX, points[i][1] * scale + offY);
		}
		ctx.closePath();

		// Gradient fill for a 3D-ish look
		const grad = ctx.createLinearGradient(0, 0, size, size);
		grad.addColorStop(0, fillColor);
		grad.addColorStop(1, fillColor + '88');
		ctx.fillStyle = grad;
		ctx.fill();

		// Outline
		ctx.strokeStyle = fillColor;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}, [silhouette, item.outline, size, fillColor]);

	return (
		<canvas
			ref={canvasRef}
			style={{ width: size, height: size }}
			className="shrink-0"
		/>
	);
}

export function ElementsModal({ open, onClose, onAdd, side }: Props) {
	const [tab, setTab] = useState<ElementTab>('elementen');

	const items = useMemo(
		() => (tab === 'elementen' ? ELEMENTEN_ITEMS : DIEPELEMENTEN_ITEMS),
		[tab]
	);

	// Group items by color/type for visual grouping
	const groups = useMemo(() => {
		const map = new Map<string, ElementLibraryItem[]>();
		for (const item of items) {
			const key = item.color;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(item);
		}
		return Array.from(map.entries());
	}, [items]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<>
			{/* Backdrop */}
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
				<div
					className="absolute inset-0"
					onMouseDown={onClose}
				/>

				{/* Modal panel */}
				<div
					className="relative z-10 flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-2xl border border-ui-border bg-ui-panel shadow-2xl"
					onMouseDown={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center justify-between border-b border-ui-border px-5 py-4">
						<div>
							<h2 className="text-base font-semibold text-ui-text">
								Elementen kiezen
							</h2>
							<p className="text-xs text-ui-muted">
								{side === 'left' ? 'Links' : 'Rechts'} – klik op een element om
								toe te voegen
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-1.5 text-sm text-ui-muted transition hover:bg-[rgba(255,255,255,0.06)]"
						>
							Sluiten
						</button>
					</div>

					{/* Tab bar */}
					<div className="flex items-center gap-2 border-b border-ui-border px-5 py-3">
						{TABS.map((t) => (
							<button
								key={t.key}
								type="button"
								onClick={() => setTab(t.key)}
								className={cn(
									'rounded-xl px-4 py-2 text-sm font-semibold transition',
									t.key === tab
										? 'bg-ui-accent text-slate-900'
										: 'text-ui-text hover:bg-[rgba(255,255,255,0.06)]'
								)}
							>
								{t.label}
							</button>
						))}
					</div>

					{/* Body – scrollable grid */}
					<div className="flex-1 overflow-y-auto p-5">
						{groups.map(([colorKey, groupItems]) => (
							<div key={colorKey} className="mb-5 last:mb-0">
								<div className="mb-2 flex items-center gap-2">
									<div
										className="h-2.5 w-2.5 rounded-full"
										style={{
											backgroundColor: ELEMENT_COLORS[colorKey] ?? '#999',
										}}
									/>
									<span className="text-[11px] font-semibold uppercase tracking-wide text-ui-muted">
										{colorKey}
									</span>
								</div>

								<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
									{groupItems.map((item) => (
										<button
											key={item.key}
											type="button"
											onClick={() => {
												onAdd(item.key);
												onClose();
											}}
											className={cn(
												'group flex flex-col items-center gap-1.5 rounded-xl border border-ui-border bg-[rgba(255,255,255,0.02)] p-3 transition',
												'hover:border-ui-accent/50 hover:bg-[rgba(255,255,255,0.05)]'
											)}
										>
											<ElementThumbnail item={item} size={48} />
											<span className="text-center text-[11px] font-medium leading-tight text-ui-text">
												{item.label}
											</span>
											<span className="text-[10px] text-ui-muted">
												{Math.abs(item.defaultHeightMm)} mm
												{item.tab === 'diepelementen' && ' diep'}
											</span>
										</button>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}
