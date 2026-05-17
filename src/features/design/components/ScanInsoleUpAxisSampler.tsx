'use client';

import { useFrame, useThree } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import { useRef } from 'react';
import * as THREE from 'three';

import {
	findMeshWithGeometry,
	worldHeightAxisFromProcessedGeometry,
} from '@/src/features/design/utils/scanManualAlignment';

type ScanInsoleUpAxisSamplerProps = {
	treeRef: MutableRefObject<THREE.Group | null>;
	geometry: THREE.BufferGeometry | null;
	active: boolean;
	onAxisWorld: (v: THREE.Vector3) => void;
};

export function ScanInsoleUpAxisSampler({
	treeRef,
	geometry,
	active,
	onAxisWorld,
}: ScanInsoleUpAxisSamplerProps) {
	const prevSig = useRef('');
	const { invalidate } = useThree();

	useFrame(() => {
		if (!active || !geometry) return;
		const mesh = findMeshWithGeometry(treeRef.current, geometry);
		if (!mesh) return;
		const axis = worldHeightAxisFromProcessedGeometry(mesh, geometry);
		const sig = axis.toArray().map((n) => n.toFixed(5)).join(',');
		if (sig !== prevSig.current) {
			prevSig.current = sig;
			onAxisWorld(axis.clone());
			invalidate();
		}
	});

	return null;
}
