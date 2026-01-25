'use client';

import {
	Suspense,
	useRef,
	useState,
	useImperativeHandle,
	forwardRef,
	useMemo,
	useEffect,
	useCallback,
} from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
// Note: Full THREE import needed for react-three-fiber compatibility
import { centerMesh, scaleMesh } from '@/src/features/design/utils/matching';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import {
	buildBasicInsole,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';
import { applyAllCorrections } from '@/src/features/design/utils/insoleCorrections';
import type { OntwerpCorrections } from '@/src/shared/components/design/OntwerpPanel';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	onGeometryReady?: (geometry: THREE.BufferGeometry) => void;
	onPickPoint?: (point: THREE.Vector3) => void;
	pointPickMode?: boolean;
	showZones?: boolean;
	corrections?: OntwerpCorrections;
	side?: 'left' | 'right';
}

// Zone colors
const ZONE_COLORS = {
	heel: new THREE.Color('#ef4444'),      // Red
	midfoot: new THREE.Color('#22c55e'),   // Green  
	forefoot: new THREE.Color('#3b82f6'),  // Blue
	arch: new THREE.Color('#f59e0b'),      // Orange/Yellow
	neutral: new THREE.Color('#d7dadd'),   // Default gray
};

// Smooth interpolation for zone boundaries
function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

// Calculate zone weights for a vertex position
function getZoneWeights(relativeY: number, relativeZ: number): { heel: number; midfoot: number; forefoot: number; arch: number } {
	const transitionWidth = 0.1;
	
	// Heel weight
	const heel = smoothstep(0.2 + transitionWidth, 0.2 - transitionWidth, relativeY);
	
	// Midfoot weight
	let midfoot = 0;
	if (relativeY < 0.2 + transitionWidth) {
		midfoot = smoothstep(0.2 - transitionWidth, 0.2 + transitionWidth, relativeY);
	} else if (relativeY > 0.5 - transitionWidth) {
		midfoot = smoothstep(0.5 + transitionWidth, 0.5 - transitionWidth, relativeY);
	} else {
		midfoot = 1;
	}
	
	// Forefoot weight
	const forefoot = smoothstep(0.5 - transitionWidth, 0.5 + transitionWidth, relativeY);
	
	// Arch weight (based on Z height)
	const archZ = smoothstep(0.2, 0.6, relativeZ);
	let archY = 1;
	if (relativeY < 0.05) {
		archY = smoothstep(0, 0.05, relativeY);
	} else if (relativeY > 0.8) {
		archY = smoothstep(1.0, 0.8, relativeY);
	}
	const arch = archZ * archY;
	
	return { heel, midfoot, forefoot, arch };
}

// Apply zone colors to geometry
function applyZoneColors(geometry: THREE.BufferGeometry): void {
	const positions = geometry.attributes.position as THREE.BufferAttribute;
	const colors = new Float32Array(positions.count * 3);
	
	// Compute bounding box
	geometry.computeBoundingBox();
	const bbox = geometry.boundingBox!;
	
	// Determine which axis is the length (heel-to-toe) - it's the longest one
	const sizeX = bbox.max.x - bbox.min.x;
	const sizeY = bbox.max.y - bbox.min.y;
	const sizeZ = bbox.max.z - bbox.min.z;
	
	// For insoles, typically Y is the longest (length), Z is height
	// But we need to detect this dynamically
	let lengthAxis: string = 'y';
	let heightAxis: string = 'z';
	
	if (sizeX > sizeY && sizeX > sizeZ) {
		lengthAxis = 'x';
		heightAxis = 'z';
	} else if (sizeY > sizeX && sizeY > sizeZ) {
		lengthAxis = 'y';
		heightAxis = 'z';
	} else {
		lengthAxis = 'z';
		heightAxis = 'y';
	}
	
	const minLength = lengthAxis === 'x' ? bbox.min.x : lengthAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxLength = lengthAxis === 'x' ? bbox.max.x : lengthAxis === 'y' ? bbox.max.y : bbox.max.z;
	const minHeight = heightAxis === 'x' ? bbox.min.x : heightAxis === 'y' ? bbox.min.y : bbox.min.z;
	const maxHeight = heightAxis === 'x' ? bbox.max.x : heightAxis === 'y' ? bbox.max.y : bbox.max.z;
	
	const lengthSpan = maxLength - minLength;
	const heightSpan = maxHeight - minHeight;
	
	const tempColor = new THREE.Color();
	
	console.log('Zone coloring - length axis:', lengthAxis, 'height axis:', heightAxis);
	console.log('Bounding box:', { sizeX, sizeY, sizeZ });
	
	for (let i = 0; i < positions.count; i++) {
		const x = positions.getX(i);
		const y = positions.getY(i);
		const z = positions.getZ(i);
		
		const lengthVal = lengthAxis === 'x' ? x : lengthAxis === 'y' ? y : z;
		const heightVal = heightAxis === 'x' ? x : heightAxis === 'y' ? y : z;
		
		const relativeLength = lengthSpan > 0 ? (lengthVal - minLength) / lengthSpan : 0;
		const relativeHeight = heightSpan > 0 ? (heightVal - minHeight) / heightSpan : 0;
		
		const weights = getZoneWeights(relativeLength, relativeHeight);
		
		// Find dominant zone
		const maxWeight = Math.max(weights.heel, weights.midfoot, weights.forefoot, weights.arch);
		
		if (maxWeight < 0.1) {
			tempColor.copy(ZONE_COLORS.neutral);
		} else if (weights.arch > 0.3 && weights.arch >= maxWeight * 0.8) {
			// Arch has priority when significant
			tempColor.copy(ZONE_COLORS.arch);
		} else if (weights.heel >= maxWeight) {
			tempColor.copy(ZONE_COLORS.heel);
		} else if (weights.forefoot >= maxWeight) {
			tempColor.copy(ZONE_COLORS.forefoot);
		} else {
			tempColor.copy(ZONE_COLORS.midfoot);
		}
		
		colors[i * 3] = tempColor.r;
		colors[i * 3 + 1] = tempColor.g;
		colors[i * 3 + 2] = tempColor.b;
	}
	
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	console.log('Zone colors applied to', positions.count, 'vertices');
}

function STLMesh({
	url,
	color = '#e8b99a',
	position = [0, 0, 0],
	onGeometryReady,
	onPickPoint,
	pointPickMode = false,
	showZones = false,
	corrections,
	side = 'left',
}: STLMeshProps) {
	const rawGeometry = useLoader(STLLoader, url);
	const meshRef = useRef<THREE.Mesh>(null);
	const processedRef = useRef(false);
	const lastCorrectionsRef = useRef<string>('');
	
	// Create a memoized processed geometry (base without corrections)
	const baseGeometry = useMemo(() => {
		// Clone the geometry so we don't modify the cached one
		const cloned = rawGeometry.clone();
		
		// Center the geometry
		const centerMatrix = centerMesh(cloned);
		cloned.applyMatrix4(centerMatrix);

		const scaleMatrix = scaleMesh(cloned, 100);
		cloned.applyMatrix4(scaleMatrix);

		// Recompute normals for better lighting
		cloned.computeVertexNormals();
		
		return cloned;
	}, [rawGeometry]);
	
	// Create a working geometry that includes corrections
	const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
	
	// Debounced corrections application to prevent UI blocking
	const pendingCorrectionsRef = useRef<OntwerpCorrections | undefined>(undefined);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	
	// Initialize geometry and apply corrections when they change (debounced)
	useEffect(() => {
		if (!baseGeometry) return;
		
		const correctionsKey = corrections ? JSON.stringify(corrections) : '';
		
		// Only recompute if corrections actually changed
		if (correctionsKey === lastCorrectionsRef.current && geometry) {
			return;
		}
		
		// Store pending corrections
		pendingCorrectionsRef.current = corrections;
		
		// Clear existing timer
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}
		
		// Debounce the expensive geometry update (150ms delay)
		debounceTimerRef.current = setTimeout(() => {
			const pendingCorrections = pendingCorrectionsRef.current;
			lastCorrectionsRef.current = pendingCorrections ? JSON.stringify(pendingCorrections) : '';
			
			// Clone base geometry for modifications
			const workingGeometry = baseGeometry.clone();
			
			// Apply corrections if provided
			if (pendingCorrections) {
				try {
					applyAllCorrections(workingGeometry, pendingCorrections, side);
					console.log(`Applied corrections to ${side} insole`);
				} catch (err) {
					console.error('Error applying corrections:', err);
				}
			}
			
			setGeometry(workingGeometry);
		}, 150);
		
		// Cleanup timer on unmount or re-render
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [baseGeometry, corrections, side]);
	
	// Apply zone colors whenever showZones changes
	useEffect(() => {
		if (geometry && showZones) {
			applyZoneColors(geometry);
		} else if (geometry && !showZones) {
			// Remove vertex colors when zones are hidden
			geometry.deleteAttribute('color');
		}
	}, [geometry, showZones]);
	
	// Notify parent about geometry
	useEffect(() => {
		if (geometry && !processedRef.current && onGeometryReady) {
			processedRef.current = true;
			onGeometryReady(geometry);
		}
	}, [geometry, onGeometryReady]);

	// Rotate mesh to face up (STL files often need rotation)
	useFrame(() => {
		if (meshRef.current && !processedRef.current) {
			meshRef.current.rotation.x = -Math.PI / 2;
		}
	});

	if (!geometry) {
		return null;
	}

	return (
		<mesh
			ref={meshRef}
			geometry={geometry}
			position={position}
			onClick={(event) => {
				if (pointPickMode && onPickPoint) {
					event.stopPropagation();
					onPickPoint(event.point.clone());
				}
			}}
		>
			<meshStandardMaterial
				key={showZones ? 'zones' : 'normal'}
				color={showZones ? '#ffffff' : color}
				vertexColors={showZones}
				roughness={0.3}
				metalness={0.0}
				flatShading={false}
			/>
		</mesh>
	);
}

interface EnhancedSTLViewerProps {
	leftUrl?: string;
	rightUrl?: string;
	showGrid?: boolean;
	showBasePreview?: boolean;
	lockTopView?: boolean;
	hideScans?: boolean;
	pointPickMode?: boolean;
	showZones?: boolean;
	corrections?: import('@/src/shared/components/design/OntwerpPanel').OntwerpCorrections;
	onPickPoint?: (point: [number, number, number]) => void;
	pickedPoints?: Array<[number, number, number]>;
	onRightBBox?: (box: THREE.Box3) => void;
	landmarkPoints?: LandmarkPoints | null;
	showGeneratedInsole?: boolean;
}

function BaseInsolePreview({
	position,
}: {
	position: [number, number, number];
}) {
	const gltf = useLoader(GLTFLoader, '/models/footcad-base/scene.gltf');
	const scene = useMemo(() => {
		const cloned = gltf.scene.clone(true);
		const box = new THREE.Box3().setFromObject(cloned);
		const center = box.getCenter(new THREE.Vector3());
		cloned.position.sub(center); // center at origin
		// Rotate 180° around X so heel is nearer, no Y flip
		cloned.rotation.set(Math.PI, 0, 0);
		cloned.traverse((obj) => {
			if ((obj as THREE.Mesh).isMesh) {
				const mesh = obj as THREE.Mesh;
				mesh.material = new THREE.MeshStandardMaterial({
					color: '#6ee7b7',
					opacity: 0.85,
					transparent: true,
					roughness: 0.35,
					metalness: 0.05,
				});
				mesh.castShadow = true;
				mesh.receiveShadow = true;
			}
		});
		return cloned;
	}, [gltf.scene]);

	return <primitive object={scene} position={position} />;
}

export interface EnhancedSTLViewerRef {
	match: () => void;
	reset: () => void;
	getInsoleGeometry: () => THREE.BufferGeometry | null;
}

export const EnhancedSTLViewer = forwardRef<
	EnhancedSTLViewerRef,
	EnhancedSTLViewerProps
>(
	(
		{
			leftUrl,
			rightUrl,
			showGrid = true,
			showBasePreview = false,
			lockTopView = false,
			hideScans = false,
			pointPickMode = false,
			showZones = false,
			corrections,
			onPickPoint,
			pickedPoints = [],
			onRightBBox,
			landmarkPoints,
			showGeneratedInsole = false,
		},
		ref
	) => {
		const [leftGeometry, setLeftGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [rightGeometry, setRightGeometry] =
			useState<THREE.BufferGeometry | null>(null);
		const [localLandmarks, setLocalLandmarks] = useState<LandmarkPoints | null>(
			null
		);
		const generatedInsole = useMemo(() => {
			if (!showGeneratedInsole) return null;
			if (!rightGeometry || !localLandmarks) return null;
			return buildBasicInsole(rightGeometry, localLandmarks, {
				padScale: 1.02,
				thickness: 0.004,
				archBoost: 0.75,
				heelCupDepth: 0.007,
				toeTaper: 0.14,
				heelTaper: 0.08,
				resU: 140,
				resV: 70,
			});
		}, [rightGeometry, localLandmarks, showGeneratedInsole]);
		const { setMatchTransform } = useDesignStore();
		const leftMeshRef = useRef<THREE.Group>(null);
		const rightMeshRef = useRef<THREE.Group>(null);
		const cameraRef = useRef<THREE.PerspectiveCamera>(null);
		const controlsRef = useRef<OrbitControlsImpl | null>(null);

		const handleLogCamera = () => {
			const cam = cameraRef.current;
			const ctrl = controlsRef.current;
			if (!cam) return;
			// Camera debug info - only in development
			if (process.env.NODE_ENV === 'development') {
				const payload = {
					position: cam.position.toArray(),
					target: ctrl?.target?.toArray ? ctrl.target.toArray() : [0, 0, 0],
					up: cam.up.toArray(),
				};
				console.log('CameraView', payload);
			}
		};

		const handleMatch = () => {
			if (leftGeometry && rightGeometry) {
				// Simple matching: center both and align
				// In production, use ICP algorithm
				const leftCenter = new THREE.Vector3();
				const rightCenter = new THREE.Vector3();
				leftGeometry.computeBoundingBox();
				rightGeometry.computeBoundingBox();
				leftGeometry.boundingBox!.getCenter(leftCenter);
				rightGeometry.boundingBox!.getCenter(rightCenter);

				// Calculate offset to align centers
				const offset = new THREE.Vector3().subVectors(rightCenter, leftCenter);

				const transform = {
					translation: [offset.x, offset.y, offset.z] as [
						number,
						number,
						number,
					],
					rotation: [0, 0, 0] as [number, number, number],
					scale: 1,
				};

				setMatchTransform(transform);
			}
		};

		const handleReset = () => {
			setMatchTransform({
				translation: [0, 0, 0],
				rotation: [0, 0, 0],
				scale: 1,
			});
			if (leftMeshRef.current) {
				leftMeshRef.current.position.set(-50, 0, 0);
			}
			if (rightMeshRef.current) {
				rightMeshRef.current.position.set(50, 0, 0);
			}
		};

		useImperativeHandle(ref, () => ({
			match: handleMatch,
			reset: handleReset,
			getInsoleGeometry: () => generatedInsole,
		}));

		useEffect(() => {
			if (!landmarkPoints || !rightMeshRef.current) {
				Promise.resolve().then(() => setLocalLandmarks(null));
				return;
			}
			rightMeshRef.current.updateWorldMatrix(true, false);
			const inv = new THREE.Matrix4()
				.copy(rightMeshRef.current.matrixWorld)
				.invert();
			const toLocal = (p: [number, number, number]) =>
				new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(inv);

			const next: LandmarkPoints = {
				meta1: toLocal(landmarkPoints.meta1).toArray() as [
					number,
					number,
					number,
				],
				meta5: toLocal(landmarkPoints.meta5).toArray() as [
					number,
					number,
					number,
				],
				navicular: toLocal(landmarkPoints.navicular).toArray() as [
					number,
					number,
					number,
				],
				calcaneus: toLocal(landmarkPoints.calcaneus).toArray() as [
					number,
					number,
					number,
				],
				heel: toLocal(landmarkPoints.heel).toArray() as [
					number,
					number,
					number,
				],
			};
			Promise.resolve().then(() => setLocalLandmarks(next));
		}, [landmarkPoints, rightGeometry]);

		useEffect(() => {
			return () => {
				generatedInsole?.dispose?.();
			};
		}, [generatedInsole]);

		// Log camera + target whenever view is applied so you can copy values
		useEffect(() => {
			// Camera view logging - only in development
			if (
				process.env.NODE_ENV === 'development' &&
				cameraRef.current &&
				controlsRef.current
			) {
				const cam = cameraRef.current;
				const ctrl = controlsRef.current;
				console.log('CameraView', {
					position: cam.position.toArray(),
					target: ctrl.target.toArray(),
					up: cam.up.toArray(),
				});
			}
		});

		useEffect(() => {
			if (!cameraRef.current || !controlsRef.current) return;

			const cam = cameraRef.current;
			const c = controlsRef.current;

			if (lockTopView) {
				// Strict 90° top view for point picking
				cam.position.set(0, 320, 0.001);
				cam.up.set(0, 0, 1);
				cam.lookAt(0, 0, 0);
				c.enableRotate = false;
				c.enablePan = true;
				c.enableZoom = true;
				c.minPolarAngle = 0;
				c.maxPolarAngle = 0;
				c.minAzimuthAngle = 0;
				c.maxAzimuthAngle = 0;
				c.target.set(0, 0, 0);
			} else {
				// Preferred angled view - closer to insoles
				cam.position.set(0, -60, 180);
				cam.up.set(0, 1, 0);
				cam.lookAt(0, 0, 0);
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
				c.minPolarAngle = 0.2;
				c.maxPolarAngle = 0.9;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;
				c.target.set(0, 0, 0);
			}
			c.update();
			handleLogCamera();
		}, [lockTopView]);

		// Reframe to the right foot when in top-down pick mode
		useEffect(() => {
			if (
				!lockTopView ||
				!rightGeometry ||
				!cameraRef.current ||
				!controlsRef.current
			)
				return;

			const posAttr = rightGeometry.getAttribute(
				'position'
			) as THREE.BufferAttribute;
			const box = new THREE.Box3().setFromBufferAttribute(posAttr);
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());
			const span = Math.max(size.x, size.y, size.z);
			const height = Math.max(span * 1.2, 180);

			const cam = cameraRef.current;
			const c = controlsRef.current;
			cam.position.set(center.x, center.y + height, center.z);
			cam.up.set(0, 0, 1);
			cam.lookAt(center);
			c.target.copy(center);
			c.update();
		}, [lockTopView, rightGeometry]);

		return (
			<div className="w-full h-full bg-gray-900 relative">
				<Canvas>
					<PerspectiveCamera
						ref={cameraRef}
						makeDefault
						position={[0, -60, 180]}
						fov={50}
					/>
					<ambientLight intensity={0.4} />
					<directionalLight position={[50, 50, 50]} intensity={1.5} />
					<directionalLight position={[-50, 50, -50]} intensity={1.0} />
					<directionalLight position={[0, 100, 0]} intensity={0.8} />
					<directionalLight position={[0, -50, 50]} intensity={0.6} />

					<Suspense fallback={null}>
						{!hideScans && leftUrl && (
							<group ref={leftMeshRef}>
								<STLMesh
									url={leftUrl}
									color="#d7dadd"
									position={[-50, 0, 0]}
									onGeometryReady={setLeftGeometry}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									corrections={corrections}
									side="left"
								/>
							</group>
						)}
						{!hideScans && rightUrl && (
							<group ref={rightMeshRef}>
								<STLMesh
									url={rightUrl}
									color="#d7dadd"
									position={[50, 0, 0]}
									onGeometryReady={(geom) => {
										setRightGeometry(geom);
										if (onRightBBox) {
											const posAttr = geom.getAttribute(
												'position'
											) as THREE.BufferAttribute;
											const box = new THREE.Box3().setFromBufferAttribute(
												posAttr
											);
											onRightBBox(box);
										}
									}}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
									showZones={showZones}
									corrections={corrections}
									side="right"
								/>
							</group>
						)}

						{/* Base template preview when requested */}
						{showBasePreview && (
							<group>
								<BaseInsolePreview position={[-80, 0, 0]} />
								<BaseInsolePreview position={[80, 0, 0]} />
							</group>
						)}
						{showGeneratedInsole && generatedInsole && (
							<mesh geometry={generatedInsole} position={[80, 0, 0]}>
								<meshStandardMaterial
									color="#6ee7b7"
									opacity={0.55}
									transparent
									roughness={0.35}
									metalness={0.05}
								/>
							</mesh>
						)}
					</Suspense>

					{pointPickMode &&
						pickedPoints?.map((pt, idx) => (
							<mesh key={`${pt.join('-')}-${idx}`} position={pt}>
								<sphereGeometry args={[3, 18, 18]} />
								<meshStandardMaterial
									color="#111827"
									emissive="#10b981"
									emissiveIntensity={0.35}
								/>
							</mesh>
						))}

					<OrbitControls
						ref={controlsRef}
						enablePan={true}
						enableZoom={true}
						enableRotate={!lockTopView}
						minDistance={50}
						maxDistance={500}
						minPolarAngle={lockTopView ? 0 : Math.PI / 4}
						maxPolarAngle={lockTopView ? 0 : Math.PI / 2}
						minAzimuthAngle={lockTopView ? 0 : undefined}
						maxAzimuthAngle={lockTopView ? 0 : undefined}
					/>
				</Canvas>
			</div>
		);
	}
);

EnhancedSTLViewer.displayName = 'EnhancedSTLViewer';
