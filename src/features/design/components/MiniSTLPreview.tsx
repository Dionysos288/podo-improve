'use client';

import { Canvas, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';

export function MiniSTLPreview({ url }: { url?: string }) {
	if (!url) {
		return (
			<div className="flex h-full items-center justify-center text-(--ui-muted)">
				Geen preview
			</div>
		);
	}

	const geometry = useLoader(STLLoader, url);
	const { mesh, center, distance } = useMemo(() => {
		const geo = geometry.clone();
		// Match point-pick orientation used in EnhancedSTLViewer
		geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
		geo.computeVertexNormals();
		geo.computeBoundingBox();
		const box = geo.boundingBox ?? new THREE.Box3();
		const c = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const span = Math.max(size.x, size.z);
		const fov = 35;
		const halfFovRad = THREE.MathUtils.degToRad(fov / 2);
		const dist = Math.max((span * 1.05) / Math.tan(halfFovRad), 110);
		return { mesh: geo, center: c, distance: dist };
	}, [geometry]);

	return (
		<Canvas camera={{ position: [0, distance, 0], up: [0, 0, -1], fov: 35 }}>
			<ambientLight intensity={0.6} />
			<directionalLight position={[50, 100, 120]} intensity={0.8} />
			<Suspense fallback={null}>
				<mesh geometry={mesh} position={[-center.x, -center.y, -center.z]}>
					<meshStandardMaterial
						color="#d9b5a1"
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

