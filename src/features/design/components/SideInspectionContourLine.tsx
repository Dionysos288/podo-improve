'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useState } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export type SideInspectionContourLineProps = {
	points: THREE.Vector3[];
	color: THREE.ColorRepresentation;
	/** Width in world units (meaningful when `worldUnits` is true). */
	lineWidthWorld: number;
	renderOrder?: number;
};

export function SideInspectionContourLine({
	points,
	color,
	lineWidthWorld,
	renderOrder = 6,
}: SideInspectionContourLineProps) {
	const size = useThree((s) => s.size);
	const [line, setLine] = useState<Line2 | null>(null);

	useLayoutEffect(() => {
		const geom = new LineGeometry();
		const mat = new LineMaterial({
			color: new THREE.Color(color),
			linewidth: lineWidthWorld,
			worldUnits: true,
			depthTest: true,
			transparent: false,
			toneMapped: false,
		});
		const l = new Line2(geom, mat);
		l.frustumCulled = false;
		setLine(l);
		return () => {
			geom.dispose();
			mat.dispose();
			setLine(null);
		};
	}, []);

	useLayoutEffect(() => {
		if (!line) return;
		line.renderOrder = renderOrder;
		const mat = line.material as LineMaterial;
		mat.linewidth = lineWidthWorld;
		mat.color.set(color);
	}, [line, color, lineWidthWorld, renderOrder]);

	useLayoutEffect(() => {
		if (!line || points.length < 2) return;
		line.geometry.setFromPoints(points);
		line.geometry.computeBoundingSphere();
	}, [line, points]);

	useFrame(() => {
		if (!line) return;
		(line.material as LineMaterial).resolution.set(size.width, size.height);
	});

	if (!line || points.length < 2) return null;

	return <primitive object={line} />;
}
