'use client';

import { useState, useCallback, useRef } from 'react';
import { DynamicInsoleEditor } from './DynamicInsoleEditor';
import { InsoleEditControls } from './InsoleEditControls';
import * as THREE from 'three';

interface DynamicInsoleWorkspaceProps {
	stlUrl: string;
}

export function DynamicInsoleWorkspace({ stlUrl }: DynamicInsoleWorkspaceProps) {
	const [editingMode, setEditingMode] = useState<
		'none' | 'grid' | 'zone' | 'material'
	>('none');
	const [currentGeometry, setCurrentGeometry] =
		useState<THREE.BufferGeometry | null>(null);
	const [showZones, setShowZones] = useState(false);
	const [gridCols, setGridCols] = useState(10);
	const [gridRows, setGridRows] = useState(25);
	const [selectedGridPoints, setSelectedGridPoints] = useState<Set<string>>(new Set());

	const handleGeometryReady = useCallback(
		(geometry: THREE.BufferGeometry) => {
			setCurrentGeometry(geometry);
		},
		[]
	);

	const handleGeometryUpdate = useCallback(
		(geometry: THREE.BufferGeometry) => {
			setCurrentGeometry(geometry.clone());
		},
		[]
	);

	const gridClickHandlerRef = useRef<((col: number, row: number) => void) | null>(null);

	const handleGridClick = useCallback(
		(colIndex: number, rowIndex: number) => {
			if (gridClickHandlerRef.current) {
				gridClickHandlerRef.current(colIndex, rowIndex);
			}
		},
		[]
	);

	return (
		<div className="flex h-full w-full">
			<div className="flex-1 relative">
				<DynamicInsoleEditor
					stlUrl={stlUrl}
					showGrid={true}
					editingMode={editingMode}
					onGridClick={handleGridClick}
					showZones={showZones}
					onGeometryReady={handleGeometryReady}
					geometry={currentGeometry}
				/>
			</div>
			<div className="w-80 border-l border-gray-700 bg-gray-800 overflow-y-auto">
				<div className="p-4">
					<InsoleEditControls
						geometry={currentGeometry}
						gridCols={gridCols}
						gridRows={gridRows}
						onGeometryUpdate={handleGeometryUpdate}
						onEditingModeChange={setEditingMode}
						onShowZonesChange={setShowZones}
						onGridClickHandlerReady={(handler) => {
							gridClickHandlerRef.current = handler;
						}}
						editingMode={editingMode}
						showZones={showZones}					selectedGridPoints={selectedGridPoints}
					onSelectedGridPointsChange={setSelectedGridPoints}					/>
				</div>
			</div>
		</div>
	);
}
