'use client';

import {
	Suspense,
	useRef,
	useState,
	useMemo,
	useEffect,
	useCallback,
} from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { centerMesh, scaleMesh } from '@/src/features/design/utils/matching';
import { preprocessInsoleGeometry } from '@/src/features/design/utils/stlPreprocessing';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import type { InsoleZone } from '@/src/features/design/types/types';

interface GridPointsProps {
	geometry: THREE.BufferGeometry;
	gridCols: number;
	gridRows: number;
	onPointClick?: (col: number, row: number, isMultiSelect: boolean) => void;
	selectedPoints?: Set<string>;
}

function GridPoints({ geometry, gridCols, gridRows, onPointClick, selectedPoints }: GridPointsProps) {
	const points = useMemo(() => {
		geometry.computeBoundingBox();
		const bbox = geometry.boundingBox!;
		const positions = geometry.attributes.position as THREE.BufferAttribute;
		
		if (!positions) return [];
		
		const minX = bbox.min.x;
		const maxX = bbox.max.x;
		const minY = bbox.min.y;
		const maxY = bbox.max.y;
		
		const result = [];
		
		// Create uniform grid points
		for (let row = 0; row < gridRows; row++) {
			for (let col = 0; col < gridCols; col++) {
				// Calculate normalized position (0-1)
				const normalizedX = col / (gridCols - 1);
				const normalizedY = row / (gridRows - 1);
				
				// Map to actual coordinates
				const x = minX + normalizedX * (maxX - minX);
				const y = minY + normalizedY * (maxY - minY);
				
				// Find the closest vertex Z position for this grid point
				let closestZ = 0;
				let minDist = Infinity;
				
				for (let i = 0; i < positions.count; i++) {
					const vx = positions.getX(i);
					const vy = positions.getY(i);
					const dist = Math.sqrt((vx - x) ** 2 + (vy - y) ** 2);
					
					if (dist < minDist) {
						minDist = dist;
						closestZ = positions.getZ(i);
					}
				}
				
				result.push({
					col,
					row,
					position: new THREE.Vector3(x, y, closestZ + 1) // Offset above surface
				});
			}
		}
		
		return result;
	}, [geometry, gridCols, gridRows]);
	
	return (
		<>
			{points.map(({ col, row, position }) => {
				const key = `${col}-${row}`;
				const isSelected = selectedPoints?.has(key) || false;
				
				return (
					<mesh
						key={key}
						position={[position.x, position.y, position.z]}
						onPointerDown={(e) => {
							e.stopPropagation();
						}}
					onPointerUp={(e) => {
						e.stopPropagation();
						const pointerEvent = e.nativeEvent as PointerEvent;
						const isMultiSelect = pointerEvent.shiftKey || pointerEvent.ctrlKey || pointerEvent.metaKey;
							onPointClick?.(col, row, isMultiSelect);
						}}
					>
						<sphereGeometry args={isSelected ? [1.5, 16, 16] : [1.2, 16, 16]} />
						<meshStandardMaterial
							color={isSelected ? "#ffff00" : "#00ffff"}
							emissive={isSelected ? "#ffaa00" : "#00aaaa"}
							emissiveIntensity={isSelected ? 0.8 : 0.5}
							transparent
							opacity={isSelected ? 1.0 : 0.8}
						/>
					</mesh>
				);
			})}
		</>
	);
}

interface DynamicInsoleMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	onGeometryReady?: (geometry: THREE.BufferGeometry) => void;
	onPreprocessed?: (data: {
		geometry: THREE.BufferGeometry;
		gridCols: number;
		gridRows: number;
		landmarks: any;
	}) => void;
	editingMode?: 'none' | 'grid' | 'zone' | 'material';
	onGridClick?: (colIndex: number, rowIndex: number) => void;
	showZones?: boolean;
	showGrid?: boolean;
	geometry?: THREE.BufferGeometry | null;
}

function DynamicInsoleMesh({
	url,
	color = '#e8b99a',
	position = [0, 0, 0],
	onGeometryReady,
	onPreprocessed,
	editingMode = 'none',
	onGridClick,
	showZones = false,
	showGrid = false,
	geometry: externalGeometry,
}: DynamicInsoleMeshProps) {
	const geometry = useLoader(STLLoader, url);
	const meshRef = useRef<THREE.Mesh>(null);
	const processedRef = useRef(false);
	const processedGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const originalGeometryRef = useRef<THREE.BufferGeometry | null>(null);

	useEffect(() => {
		if (geometry && !processedRef.current) {
			const cloned = geometry.clone();

			cloned.computeVertexNormals();
			cloned.computeBoundingBox();

			originalGeometryRef.current = cloned.clone();

			const preprocessed = preprocessInsoleGeometry(cloned, {
				gridCols: 10,
				gridRows: 25,
				decimateTarget: 0,
			});

			processedGeometryRef.current = preprocessed.geometry;
			processedRef.current = true;
			
			onGeometryReady?.(preprocessed.geometry);
			onPreprocessed?.(preprocessed);
		}
	}, [geometry, onGeometryReady, onPreprocessed]);


	const handleClick = useCallback(
		(event: any) => {
			if (editingMode === 'grid' && onGridClick && meshRef.current) {
				event.stopPropagation();

				const geometry = meshRef.current.geometry;
				const gridAttr = geometry.attributes.gridIndex as THREE.BufferAttribute;

				if (!gridAttr) return;

				const face = event.face;
				if (face) {
					const vertexIndex = face.a;
					const col = Math.floor(gridAttr.getX(vertexIndex) * 9);
					const row = Math.floor(gridAttr.getY(vertexIndex) * 24);
					onGridClick(col, row);
				}
			}
		},
		[editingMode, onGridClick]
	);

	const material = useMemo(() => {
		if (showZones) {
			return new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 0.3,
				metalness: 0.0,
				flatShading: false,
			});
		}
		return new THREE.MeshStandardMaterial({
			color,
			roughness: 0.3,
			metalness: 0.0,
			flatShading: false,
		});
	}, [showZones, color]);

	const displayGeometry = externalGeometry || processedGeometryRef.current || geometry;

	useEffect(() => {
		if (meshRef.current) {
			const geom = externalGeometry || processedGeometryRef.current || geometry;
			if (geom) {
				if (showZones && geom.attributes.zones) {
					const zonesAttr = geom.attributes.zones as THREE.BufferAttribute;
					const colors = new Float32Array(zonesAttr.count * 3);
					for (let i = 0; i < zonesAttr.count; i++) {
						colors[i * 3] = zonesAttr.getX(i);
						colors[i * 3 + 1] = zonesAttr.getY(i);
						colors[i * 3 + 2] = zonesAttr.getZ(i);
					}
					geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
				} else if (geom.attributes.color) {
					geom.deleteAttribute('color');
				}
				meshRef.current.geometry = geom;
			}
		}
	}, [externalGeometry, showZones, geometry]);

	return (
		<>
			<mesh
				ref={meshRef}
				geometry={displayGeometry}
				position={position}
				material={material}
				onClick={handleClick}
			/>
		</>
	);
}

interface DynamicInsoleEditorProps {
	stlUrl: string;
	showGrid?: boolean;
	editingMode?: 'none' | 'grid' | 'zone' | 'material';
	onGridClick?: (colIndex: number, rowIndex: number) => void;
	showZones?: boolean;
	onGeometryReady?: (geometry: THREE.BufferGeometry) => void;
	geometry?: THREE.BufferGeometry | null;
	selectedGridPoints?: Set<string>;
	onSelectedGridPointsChange?: (selected: Set<string>) => void;
}

export function DynamicInsoleEditor({
	stlUrl,
	showGrid = true,
	editingMode = 'none',
	onGridClick,
	showZones = false,
	onGeometryReady,
	geometry: externalGeometry,
	selectedGridPoints,
	onSelectedGridPointsChange,
}: DynamicInsoleEditorProps) {
	const [preprocessedData, setPreprocessedData] = useState<{
		geometry: THREE.BufferGeometry;
		gridCols: number;
		gridRows: number;
		landmarks: any;
	} | null>(null);
	const { setInsoleAttributes, setLandmarks } = useDesignStore();
	const cameraRef = useRef<THREE.PerspectiveCamera>(null);
	const controlsRef = useRef<OrbitControlsImpl | null>(null);

	useEffect(() => {
		if (preprocessedData) {
			setInsoleAttributes({
				gridCols: preprocessedData.gridCols,
				gridRows: preprocessedData.gridRows,
				zones: ['heel', 'midfoot', 'forefoot', 'arch'],
				materials: [],
			});
			setLandmarks(preprocessedData.landmarks);
			onGeometryReady?.(preprocessedData.geometry);
		}
	}, [preprocessedData, setInsoleAttributes, setLandmarks, onGeometryReady]);

	return (
		<div className="w-full h-full bg-gray-900 relative">
			<Canvas>
				<PerspectiveCamera
					ref={cameraRef}
					makeDefault
					position={[-14, -115, 348]}
					fov={50}
				/>
				<ambientLight intensity={0.4} />
				<directionalLight position={[50, 50, 50]} intensity={1.5} />
				<directionalLight position={[-50, 50, -50]} intensity={1.0} />
				<directionalLight position={[0, 100, 0]} intensity={0.8} />
				<directionalLight position={[0, -50, 50]} intensity={0.6} />

				{showGrid && (
					<Grid
						args={[200, 200]}
						cellColor="#6f6f6f"
						sectionColor="#9d4b4b"
					/>
				)}

				<Suspense fallback={null}>
					<DynamicInsoleMesh
						url={stlUrl}
						color="#e8b99a"
						position={[0, 0, 0]}
						onPreprocessed={setPreprocessedData}
						editingMode={editingMode}
						onGridClick={onGridClick}
						showZones={showZones}
						showGrid={showGrid}
						geometry={externalGeometry}
					/>
					{editingMode === 'grid' && preprocessedData && (
						<GridPoints
							geometry={externalGeometry || preprocessedData.geometry}
							gridCols={preprocessedData.gridCols}
							gridRows={preprocessedData.gridRows}
							onPointClick={(col, row, isMultiSelect) => {
								const key = `${col}-${row}`;
							if (isMultiSelect) {
								const newSelected = new Set(selectedGridPoints || []);
								if (newSelected.has(key)) {
									newSelected.delete(key);
								} else {
									newSelected.add(key);
								}
								onSelectedGridPointsChange?.(newSelected);
							} else {
									onSelectedGridPointsChange?.(new Set([key]));
								}
								onGridClick?.(col, row);
							}}
							selectedPoints={selectedGridPoints}
						/>
					)}
				</Suspense>

				<OrbitControls
					ref={controlsRef}
					enablePan={editingMode !== 'grid'}
					enableZoom={true}
					enableRotate={editingMode !== 'grid'}
					minDistance={180}
					maxDistance={700}
					target={[-8, -115, -0.14]}
					mouseButtons={editingMode === 'grid' ? {
						LEFT: undefined,
						MIDDLE: 2,
						RIGHT: undefined
					} : undefined}
				/>
			</Canvas>
		</div>
	);
}
