'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { useDesignStore } from '@/src/shared/core/store/designStore';
import type { InsoleZone } from '@/src/features/design/types/types';
import {
	liftGridSquare,
	liftMultipleGridPoints,
	adjustZone,
	applyMaterialOverlay,
	removeMaterialOverlay,
	exportModifiedGeometry,
} from '@/src/features/design/utils/insoleEditing';
import * as THREE from 'three';

interface InsoleEditControlsProps {
	geometry: THREE.BufferGeometry | null;
	gridCols?: number;
	gridRows?: number;
	onGeometryUpdate?: (geometry: THREE.BufferGeometry) => void;
	onEditingModeChange?: (mode: 'none' | 'grid' | 'zone' | 'material') => void;
	onShowZonesChange?: (show: boolean) => void;
	onGridClick?: (colIndex: number, rowIndex: number) => void;
	onGridClickHandlerReady?: (handler: (col: number, row: number) => void) => void;
	editingMode?: 'none' | 'grid' | 'zone' | 'material';
	showZones?: boolean;
	selectedGridPoints?: Set<string>;
	onSelectedGridPointsChange?: (selected: Set<string>) => void;
}

type EditingMode = 'none' | 'grid' | 'zone' | 'material';

export function InsoleEditControls({
	geometry,
	gridCols = 10,
	gridRows = 25,
	onGeometryUpdate,
	onEditingModeChange,
	onShowZonesChange,
	onGridClick,
	onGridClickHandlerReady,
	editingMode: externalEditingMode,
	showZones: externalShowZones,
	selectedGridPoints,
	onSelectedGridPointsChange,
}: InsoleEditControlsProps) {
	const [internalEditingMode, setInternalEditingMode] = useState<EditingMode>('none');
	const [internalShowZones, setInternalShowZones] = useState(false);
	
	const editingMode = externalEditingMode ?? internalEditingMode;
	const showZones = externalShowZones ?? internalShowZones;
	const [selectedGridSquare, setSelectedGridSquare] = useState<{
		col: number;
		row: number;
	} | null>(null);
	const [gridLiftAmount, setGridLiftAmount] = useState(0.1);
	const [zoneAdjustments, setZoneAdjustments] = useState<Record<InsoleZone, number>>({
		heel: 0,
		midfoot: 0,
		forefoot: 0,
		arch: 0,
	});
	const [selectedMaterial, setSelectedMaterial] = useState<string>('none');
	const originalGeometryRef = useRef<THREE.BufferGeometry | null>(null);

	const { addGridEdit, addZoneAdjustment } = useDesignStore();

	const handleGridClickInternal = useCallback(
		(colIndex: number, rowIndex: number) => {
			if (editingMode === 'grid' && geometry) {
				setSelectedGridSquare({ col: colIndex, row: rowIndex });
				onGridClick?.(colIndex, rowIndex);
			}
		},
		[editingMode, geometry, onGridClick]
	);

	useEffect(() => {
		if (onGridClickHandlerReady) {
			onGridClickHandlerReady(handleGridClickInternal);
		}
	}, [handleGridClickInternal, onGridClickHandlerReady]);

	const handleLiftGridSquare = useCallback(() => {
		if (!geometry) return;
		
		// Check if we have multiple selected points or just one
		if (selectedGridPoints && selectedGridPoints.size > 0) {
			const cloned = geometry.clone();
			const points = Array.from(selectedGridPoints).map(key => {
				const [col, row] = key.split('-').map(Number);
				return { col, row };
			});
			
			liftMultipleGridPoints(
				cloned,
				points,
				gridLiftAmount,
				gridCols,
				gridRows
			);
			
			// Log to store for each point
			points.forEach(point => {
				addGridEdit({
					colIndex: point.col,
					rowIndex: point.row,
					amount: gridLiftAmount,
					timestamp: Date.now(),
				});
			});
			
			onGeometryUpdate?.(cloned);
		} else if (selectedGridSquare) {
			// Fallback to single point
			const cloned = geometry.clone();
			liftGridSquare(
				cloned,
				selectedGridSquare.col,
				selectedGridSquare.row,
				gridLiftAmount,
				gridCols,
				gridRows
			);

			addGridEdit({
				colIndex: selectedGridSquare.col,
				rowIndex: selectedGridSquare.row,
				amount: gridLiftAmount,
				timestamp: Date.now(),
			});

			onGeometryUpdate?.(cloned);
		}
	}, [geometry, selectedGridSquare, selectedGridPoints, gridLiftAmount, gridCols, gridRows, onGeometryUpdate, addGridEdit]);

	const handleZoneAdjust = useCallback(
		(zone: InsoleZone, newValue: number) => {
			if (!geometry) return;

			const delta = newValue - zoneAdjustments[zone];
			if (Math.abs(delta) < 0.01) return;

			const cloned = geometry.clone();
			adjustZone(cloned, zone, delta);

			setZoneAdjustments((prev) => ({ ...prev, [zone]: newValue }));

			addZoneAdjustment({
				zone,
				amount: delta,
				timestamp: Date.now(),
			});

			onGeometryUpdate?.(cloned);
		},
		[geometry, zoneAdjustments, onGeometryUpdate, addZoneAdjustment]
	);

	const handleApplyMaterial = useCallback(
		(zone: InsoleZone) => {
			if (!geometry) return;

			const cloned = geometry.clone();
			if (selectedMaterial === 'none') {
				removeMaterialOverlay(cloned, zone);
			} else {
				applyMaterialOverlay(cloned, zone, selectedMaterial);
			}

			onGeometryUpdate?.(cloned);
		},
		[geometry, selectedMaterial, onGeometryUpdate]
	);

	const handleExport = useCallback(() => {
		if (!geometry) return;
		exportModifiedGeometry(geometry, 'edited-insole.stl');
	}, [geometry]);

	const materialOptions = [
		{ value: 'none', label: 'None' },
		{ value: 'overlay1', label: 'Overlay 1' },
		{ value: 'inset', label: 'Inset/Hole' },
		{ value: 'overlay2', label: 'Overlay 2' },
		{ value: 'overlay3', label: 'Overlay 3' },
	];

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Edit Modes</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<div className="flex gap-2 flex-wrap">
						<Button
							variant={editingMode === 'none' ? 'default' : 'outline'}
							size="sm"
							onClick={() => {
								const mode = 'none';
								if (externalEditingMode === undefined) setInternalEditingMode(mode);
								onEditingModeChange?.(mode);
							}}
						>
							None
						</Button>
						<Button
							variant={editingMode === 'grid' ? 'default' : 'outline'}
							size="sm"
							onClick={() => {
								const mode = 'grid';
								if (externalEditingMode === undefined) setInternalEditingMode(mode);
								onEditingModeChange?.(mode);
							}}
						>
							Grid Edit
						</Button>
						<Button
							variant={editingMode === 'zone' ? 'default' : 'outline'}
							size="sm"
							onClick={() => {
								const mode = 'zone';
								if (externalEditingMode === undefined) setInternalEditingMode(mode);
								onEditingModeChange?.(mode);
							}}
						>
							Zone Adjust
						</Button>
						<Button
							variant={editingMode === 'material' ? 'default' : 'outline'}
							size="sm"
							onClick={() => {
								const mode = 'material';
								if (externalEditingMode === undefined) setInternalEditingMode(mode);
								onEditingModeChange?.(mode);
							}}
						>
							Material
						</Button>
					</div>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={showZones}
							onChange={(e) => {
								const checked = e.target.checked;
								if (externalShowZones === undefined) setInternalShowZones(checked);
								onShowZonesChange?.(checked);
							}}
							className="rounded"
						/>
						<span className="text-sm">Show Zones</span>
					</label>
				</CardContent>
			</Card>

			{editingMode === 'grid' && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Grid Editing</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-gray-600">
							Click points to select. Hold Shift/Ctrl for multi-select.
						</p>
						{selectedGridPoints && selectedGridPoints.size > 0 ? (
							<div className="space-y-2">
								<div className="p-2 bg-blue-50 rounded text-sm">
									Selected: {selectedGridPoints.size} point{selectedGridPoints.size > 1 ? 's' : ''}
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => onSelectedGridPointsChange?.(new Set())}
									className="w-full"
								>
									Clear Selection
								</Button>
							</div>
						) : (
							<div className="p-2 bg-gray-100 rounded text-sm text-gray-500">
								No points selected
							</div>
						)}
						{selectedGridSquare && (
							<div className="p-2 bg-blue-50 rounded text-sm">
								Last: Column {selectedGridSquare.col}, Row{' '}
								{selectedGridSquare.row}
							</div>
						)}
						<label className="flex flex-col gap-1">
							<span className="text-sm font-medium">Lift Amount</span>
							<div className="flex gap-2">
								<input
									type="range"
									min={-1}
									max={1}
									step={0.01}
									value={gridLiftAmount}
									onChange={(e) => setGridLiftAmount(Number(e.target.value))}
									className="flex-1"
								/>
								<Input
									type="number"
									min={-1}
									max={1}
									step={0.01}
									value={gridLiftAmount}
									onChange={(e) =>
										setGridLiftAmount(Number(e.target.value))
									}
									className="w-20"
								/>
							</div>
						</label>
						{(selectedGridPoints && selectedGridPoints.size > 0) || selectedGridSquare ? (
							<Button onClick={handleLiftGridSquare} className="w-full">
								Apply Lift {selectedGridPoints && selectedGridPoints.size > 1 ? `to ${selectedGridPoints.size} Points` : ''}
							</Button>
						) : null}
					</CardContent>
				</Card>
			)}

			{editingMode === 'zone' && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Zone Adjustments</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{(['heel', 'midfoot', 'forefoot', 'arch'] as InsoleZone[]).map(
							(zone) => (
								<label key={zone} className="flex flex-col gap-1">
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium capitalize">
											{zone}
										</span>
										<span className="text-xs text-gray-500">
											{zoneAdjustments[zone].toFixed(2)} mm
										</span>
									</div>
									<div className="flex gap-2">
										<input
											type="range"
											min={-5}
											max={5}
											step={0.1}
											value={zoneAdjustments[zone]}
											onChange={(e) =>
												handleZoneAdjust(zone, Number(e.target.value))
											}
											className="flex-1"
										/>
										<Input
											type="number"
											min={-5}
											max={5}
											step={0.1}
											value={zoneAdjustments[zone]}
											onChange={(e) =>
												handleZoneAdjust(zone, Number(e.target.value))
											}
											className="w-20"
										/>
									</div>
								</label>
							)
						)}
					</CardContent>
				</Card>
			)}

			{editingMode === 'material' && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Material Overlays</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<label className="flex flex-col gap-1">
							<span className="text-sm font-medium">Material Type</span>
							<select
								value={selectedMaterial}
								onChange={(e) => setSelectedMaterial(e.target.value)}
								className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
							>
								{materialOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<div className="space-y-2">
							{(['heel', 'midfoot', 'forefoot', 'arch'] as InsoleZone[]).map(
								(zone) => (
									<Button
										key={zone}
										variant="outline"
										size="sm"
										onClick={() => handleApplyMaterial(zone)}
										className="w-full capitalize"
									>
										Apply to {zone}
									</Button>
								)
							)}
						</div>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Export</CardTitle>
				</CardHeader>
				<CardContent>
					<Button onClick={handleExport} className="w-full" disabled={!geometry}>
						Export Modified STL
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
