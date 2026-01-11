'use client';

import {
	Suspense,
	useRef,
	useState,
	useImperativeHandle,
	forwardRef,
	useMemo,
	useEffect,
} from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { centerMesh, scaleMesh } from '@/src/features/design/utils/matching';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import {
	buildBasicInsole,
	type LandmarkPoints,
} from '@/src/features/design/utils/landmarkFitting';

interface STLMeshProps {
	url: string;
	color?: string;
	position?: [number, number, number];
	onGeometryReady?: (geometry: THREE.BufferGeometry) => void;
	onPickPoint?: (point: THREE.Vector3) => void;
	pointPickMode?: boolean;
}

function STLMesh({
	url,
	color = '#e8b99a',
	position = [0, 0, 0],
	onGeometryReady,
	onPickPoint,
	pointPickMode = false,
}: STLMeshProps) {
	const geometry = useLoader(STLLoader, url);
	const meshRef = useRef<THREE.Mesh>(null);
	const processedRef = useRef(false);

	useEffect(() => {
		if (geometry && !processedRef.current && onGeometryReady) {
			// Center the geometry
			const centerMatrix = centerMesh(geometry);
			geometry.applyMatrix4(centerMatrix);

			const scaleMatrix = scaleMesh(geometry, 100);
			geometry.applyMatrix4(scaleMatrix);

			// Recompute normals for better lighting
			geometry.computeVertexNormals();

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
				color={color}
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
			const payload = {
				position: cam.position.toArray(),
				target: ctrl?.target?.toArray ? ctrl.target.toArray() : [0, 0, 0],
				up: cam.up.toArray(),
			};
			console.log('CameraView', payload);
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
						number
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
				leftMeshRef.current.position.set(-80, 0, 0);
			}
			if (rightMeshRef.current) {
				rightMeshRef.current.position.set(80, 0, 0);
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
					number
				],
				meta5: toLocal(landmarkPoints.meta5).toArray() as [
					number,
					number,
					number
				],
				navicular: toLocal(landmarkPoints.navicular).toArray() as [
					number,
					number,
					number
				],
				calcaneus: toLocal(landmarkPoints.calcaneus).toArray() as [
					number,
					number,
					number
				],
				heel: toLocal(landmarkPoints.heel).toArray() as [
					number,
					number,
					number
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
			if (cameraRef.current && controlsRef.current) {
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
				// Preferred angled view
				cam.position.set(-14, -115, 348);
				cam.up.set(0, 1, 0);
				cam.lookAt(-8, -115, -0.14);
				c.enableRotate = true;
				c.enablePan = true;
				c.enableZoom = true;
				c.minPolarAngle = 0.2;
				c.maxPolarAngle = 0.9;
				c.minAzimuthAngle = -Infinity;
				c.maxAzimuthAngle = Infinity;
				c.target.set(-8, -115, -0.14);
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
						{!hideScans && leftUrl && (
							<group ref={leftMeshRef}>
								<STLMesh
									url={leftUrl}
									color="#e8b99a"
									position={[-80, 0, 0]}
									onGeometryReady={setLeftGeometry}
									onPickPoint={(pt) => onPickPoint?.([pt.x, pt.y, pt.z])}
									pointPickMode={pointPickMode}
								/>
							</group>
						)}
						{!hideScans && rightUrl && (
							<group ref={rightMeshRef}>
								<STLMesh
									url={rightUrl}
									color="#e8b99a"
									position={[80, 0, 0]}
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
						minDistance={180}
						maxDistance={700}
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
