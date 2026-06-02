/**
 * Web Worker entry for element geometry computation.
 * Runs the pure `computeElementGeometry` off the main thread.
 */
import {
	computeElementGeometry,
	type ElementGeometryComputeInput,
} from './core/elementGeometryCore';

type WorkerRequest = ElementGeometryComputeInput & { requestId: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const { requestId, ...input } = event.data;
	try {
		const result = computeElementGeometry(input);
		(self as unknown as Worker).postMessage(
			{ requestId, ok: true, positions: result.positions, colors: result.colors },
			[result.positions.buffer, result.colors.buffer],
		);
	} catch (error) {
		(self as unknown as Worker).postMessage({
			requestId,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
