import type { ObLatticeFrame, LatticeNode } from '@/src/features/design/utils/boxLattice';
import type { VertexLatticeInfluence } from '@/src/features/design/utils/boxDeformation';

export interface LatticeEditKit {
	readonly frame: ObLatticeFrame;
	readonly nodes: LatticeNode[];
	readonly cols: number;
	readonly rows: number;
	readonly layers: number;
	readonly influences: VertexLatticeInfluence;
}
