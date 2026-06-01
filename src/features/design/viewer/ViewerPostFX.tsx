'use client';

import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export type ViewerPostFXProps = {
	/** Disable to skip the whole composer (e.g. during heavy edit interactions). */
	enabled?: boolean;
	/** World-space ambient occlusion sampling radius. */
	aoRadius?: number;
	/** AO strength multiplier. */
	intensity?: number;
	/** How quickly occlusion fades with distance. */
	distanceFalloff?: number;
	/** Render AO at half resolution for performance. */
	halfRes?: boolean;
};

/**
 * Post-processing for the insole viewer: screen-space ambient occlusion darkens
 * cavities (arch hollow, heel cup) and creases so the molded form reads clearly,
 * matching the competitor's definition.
 *
 * The composer disables the renderer's tone mapping while mounted, so tone
 * mapping is re-applied here as the final effect (kept in sync with the Canvas
 * `gl.toneMapping` used when this composer is not mounted).
 */
export function ViewerPostFX({
	enabled = true,
	aoRadius = 30,
	intensity = 2.2,
	distanceFalloff = 0.9,
	halfRes = true,
}: ViewerPostFXProps) {
	if (!enabled) return null;

	return (
		<EffectComposer enableNormalPass={false} multisampling={4}>
			<N8AO
				aoRadius={aoRadius}
				distanceFalloff={distanceFalloff}
				intensity={intensity}
				quality="medium"
				halfRes={halfRes}
				color="black"
			/>
			<ToneMapping mode={ToneMappingMode.NEUTRAL} />
		</EffectComposer>
	);
}
