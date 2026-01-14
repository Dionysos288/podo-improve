'use client';

import { Suspense, useRef } from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
}

function STLMesh({
	url,
	color = '#e8b99a',
	position = [0, 0, 0],
}: STLMeshProps) {
	const geometry = useLoader(STLLoader, url);
	const meshRef = useRef<THREE.Mesh>(null);

	// Rotate mesh to face up (STL files often need rotation)
	useFrame(() => {
		if (meshRef.current) {
			meshRef.current.rotation.x = -Math.PI / 2;
		}
	});

	return (
		<mesh ref={meshRef} geometry={geometry} position={position}>
			<meshStandardMaterial
				color={color}
				roughness={0.3}
				metalness={0.0}
				flatShading={false}
			/>
		</mesh>
	);
}

interface STLViewerProps {
	leftUrl?: string;
	rightUrl?: string;
	showGrid?: boolean;
}

export function STLViewer({
	leftUrl,
	rightUrl,
	showGrid = true,
}: STLViewerProps) {
	return (
		<div className="w-full h-full bg-gray-900">
			<Canvas>
				<PerspectiveCamera makeDefault position={[0, 50, 150]} fov={50} />
				<ambientLight intensity={0.4} />
				<directionalLight position={[50, 50, 50]} intensity={1.5} />
				<directionalLight position={[-50, 50, -50]} intensity={1.0} />
				<directionalLight position={[0, 100, 0]} intensity={0.8} />
				<directionalLight position={[0, -50, 50]} intensity={0.6} />

				{showGrid && (
					<Grid args={[100, 100]} cellColor="#6f6f6f" sectionColor="#9d4b4b" />
				)}

				<Suspense fallback={null}>
					{leftUrl && (
						<STLMesh url={leftUrl} color="#e8b99a" position={[80, 0, 0]} />
					)}
					{rightUrl && (
						<STLMesh url={rightUrl} color="#e8b99a" position={[-80, 0, 0]} />
					)}
				</Suspense>

				<OrbitControls
					enablePan={true}
					enableZoom={true}
					enableRotate={true}
					minDistance={50}
					maxDistance={200}
				/>
			</Canvas>
		</div>
	);
}
