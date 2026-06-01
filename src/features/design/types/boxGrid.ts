export type LatticeOffsetVec = { du: number; dv: number; dh: number };

export const BOX_GRID_COLS = 9;
export const BOX_GRID_ROWS = 13;
export const BOX_GRID_LAYERS = 4;
/** Single height layer for orthotic element box editing (insole box keeps BOX_GRID_LAYERS). */
export const ELEMENT_BOX_GRID_LAYERS = 1;
/** Extra lattice height below/above element mesh so control handles sit inside the frame. */
export const ELEMENT_BOX_HEIGHT_PAD_BELOW_MM = 2;
export const ELEMENT_BOX_HEIGHT_PAD_ABOVE_MM = 10;
/** Sink handles slightly below the element top so spheres read on the surface, not above it. */
export const ELEMENT_BOX_HANDLE_SINK_BELOW_SURFACE_MM = 3;

export interface BoxGridSavedOffsets {
	cols: number;
	rows: number;
	layers?: number;
	version?: 2 | 3;
	offsets: number[] | LatticeOffsetVec[];
}

export function effectiveLayerCount(saved: BoxGridSavedOffsets): number {
	return Math.max(1, saved.layers ?? 1);
}

export function isLegacyOneLayer(saved: BoxGridSavedOffsets): boolean {
	return saved.version !== 3 && (saved.layers == null || saved.layers <= 1);
}

export function isLegacyScalarOffsets(
	saved: BoxGridSavedOffsets,
): saved is BoxGridSavedOffsets & { offsets: number[] } {
	return saved.version !== 2 && saved.version !== 3;
}

export function normalizeSavedOffsets(
	saved: BoxGridSavedOffsets,
	targetLayers: number = BOX_GRID_LAYERS,
): LatticeOffsetVec[] {
	const L = Math.max(1, targetLayers);
	const cols = saved.cols;
	const rows = saved.rows;
	const flat = L * rows * cols;
	const out: LatticeOffsetVec[] = new Array(flat);
	for (let i = 0; i < flat; i++) {
		out[i] = { du: 0, dv: 0, dh: 0 };
	}

	const legacyFlat = rows * cols;

	if (saved.version === 3 && Array.isArray(saved.offsets)) {
		const src = saved.offsets;
		const srcLayers = Math.max(1, saved.layers ?? L);
		for (let li = 0; li < Math.min(L, srcLayers); li++) {
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const si = (li * rows + r) * cols + c;
					const di = (li * rows + r) * cols + c;
					const o = src[si];
					if (typeof o === 'number') {
						out[di] = { du: 0, dv: 0, dh: o };
					} else if (o && typeof o === 'object') {
						out[di] = {
							du: Number(o.du) || 0,
							dv: Number(o.dv) || 0,
							dh: Number(o.dh) || 0,
						};
					}
				}
			}
		}
		return out;
	}

	if (saved.version === 2 && Array.isArray(saved.offsets)) {
		const src = saved.offsets;
		const top = L - 1;
		for (let i = 0; i < legacyFlat && i < src.length; i++) {
			const o = src[i];
			const row = Math.floor(i / cols);
			const col = i % cols;
			const di = (top * rows + row) * cols + col;
			if (typeof o === 'number') {
				out[di] = { du: 0, dv: 0, dh: o };
			} else if (o && typeof o === 'object') {
				out[di] = {
					du: Number(o.du) || 0,
					dv: Number(o.dv) || 0,
					dh: Number(o.dh) || 0,
				};
			}
		}
		return out;
	}

	const nums = saved.offsets as number[];
	const top = L - 1;
	for (let i = 0; i < legacyFlat && i < nums.length; i++) {
		const row = Math.floor(i / cols);
		const col = i % cols;
		const di = (top * rows + row) * cols + col;
		out[di] = { du: 0, dv: 0, dh: nums[i] ?? 0 };
	}
	return out;
}

export function latticeVecsToSavePayload(
	cols: number,
	rows: number,
	layers: number,
	vec: LatticeOffsetVec[],
): BoxGridSavedOffsets {
	const L = Math.max(1, layers);
	return {
		cols,
		rows,
		layers: L,
		version: 3,
		offsets: vec.map((v) => ({ du: v.du, dv: v.dv, dh: v.dh })),
	};
}
