/**
 * Hook that exposes element-geometry computation, preferring a Web Worker so
 * the heavy displacement + colour pass does not block the main thread when an
 * insole carries several elements.
 *
 * The worker is best-effort: if a worker cannot be created (SSR, unsupported
 * bundler, etc.) the same pure `computeElementGeometry` runs synchronously on
 * the main thread, so callers always get a correct result.
 */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	computeElementGeometry,
	type ElementGeometryComputeInput,
	type ElementGeometryComputeResult,
} from './core/elementGeometryCore';

type WorkerRequest = ElementGeometryComputeInput & { requestId: number };
type WorkerResponse =
	| { requestId: number; ok: true; positions: Float32Array; colors: Float32Array }
	| { requestId: number; ok: false; error: string };

export interface ElementsGeometryWorkerApi {
	compute(input: ElementGeometryComputeInput): Promise<ElementGeometryComputeResult>;
	busy: boolean;
}

function createWorker(): Worker | null {
	if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
	try {
		return new Worker(new URL('./elementsGeometry.worker.ts', import.meta.url), {
			type: 'module',
		});
	} catch {
		return null;
	}
}

export function useElementsGeometryWorker(): ElementsGeometryWorkerApi {
	const workerRef = useRef<Worker | null>(null);
	const requestIdRef = useRef(0);
	const pendingRef = useRef(
		new Map<
			number,
			{
				resolve: (r: ElementGeometryComputeResult) => void;
				reject: (e: unknown) => void;
			}
		>(),
	);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const worker = createWorker();
		workerRef.current = worker;
		if (!worker) return;

		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const data = event.data;
			const pending = pendingRef.current.get(data.requestId);
			if (!pending) return;
			pendingRef.current.delete(data.requestId);
			if (pendingRef.current.size === 0) setBusy(false);
			if (data.ok) {
				pending.resolve({ positions: data.positions, colors: data.colors });
			} else {
				pending.reject(new Error(data.error));
			}
		};

		return () => {
			worker.terminate();
			workerRef.current = null;
			const pending = pendingRef.current;
			pending.forEach((p) => p.reject(new Error('worker disposed')));
			pending.clear();
		};
	}, []);

	const compute = useCallback(
		(input: ElementGeometryComputeInput): Promise<ElementGeometryComputeResult> => {
			const worker = workerRef.current;
			if (!worker) {
				return Promise.resolve(computeElementGeometry(input));
			}
			const requestId = ++requestIdRef.current;
			setBusy(true);
			return new Promise<ElementGeometryComputeResult>((resolve, reject) => {
				pendingRef.current.set(requestId, { resolve, reject });
				const message: WorkerRequest = { ...input, requestId };
				const transfer: Transferable[] = [input.positions.buffer];
				if (input.normals) transfer.push(input.normals.buffer);
				if (input.index) transfer.push(input.index.buffer);
				try {
					worker.postMessage(message, transfer);
				} catch {
					pendingRef.current.delete(requestId);
					if (pendingRef.current.size === 0) setBusy(false);
					resolve(computeElementGeometry(input));
				}
			});
		},
		[],
	);

	return { compute, busy };
}
