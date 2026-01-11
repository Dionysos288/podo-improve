'use client';

import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { TransformControls as DreiTransformControls } from '@react-three/drei';
import * as THREE from 'three';

interface TransformControlsProps {
	object: THREE.Object3D | null;
	mode: 'translate' | 'rotate' | 'scale';
	onChange?: () => void;
}

export function TransformControls({
	object,
	mode,
	onChange,
}: TransformControlsProps) {
	const { camera, gl } = useThree();

	if (!object) return null;

	return (
		<DreiTransformControls
			object={object}
			mode={mode}
			camera={camera}
			onChange={onChange}
		/>
	);
}
