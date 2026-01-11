'use client';

import { Canvas, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Suspense, useMemo } from 'react';

export function MiniSTLPreview({ url }: { url?: string }) {
	if (!url) {
		return (
			<div className="flex h-full items-center justify-center text-(--ui-muted)">
				Geen preview
			</div>
		);
	}

	const geometry = useLoader(STLLoader, url);
	const mesh = useMemo(() => {
		const geo = geometry.clone();
		geo.computeVertexNormals();
		return geo;
	}, [geometry]);

	return (
		<Canvas camera={{ position: [0, 180, 240], up: [0, 1, 0], fov: 35 }}>
			<ambientLight intensity={0.6} />
			<directionalLight position={[50, 100, 120]} intensity={0.8} />
			<Suspense fallback={null}>
				<mesh geometry={mesh} rotation={[-Math.PI / 2, 0, 0]}>
					<meshStandardMaterial
						color="#6ee7b7"
						opacity={0.8}
						transparent
						roughness={0.35}
						metalness={0.05}
					/>
				</mesh>
			</Suspense>
		</Canvas>
	);
}

