'use client';

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { useState } from 'react';

interface Scan {
	id: string;
	footSide: string;
	stlUrl: string;
}

interface STLSelectorProps {
	scans: Scan[];
	onLeftSelect: (scanId: string) => void;
	onRightSelect: (scanId: string) => void;
	onContinue: () => void;
}

export function STLSelector({
	scans,
	onLeftSelect,
	onRightSelect,
	onContinue,
}: STLSelectorProps) {
	const [selectedLeftId, setSelectedLeftId] = useState<string | null>(null);
	const [selectedRightId, setSelectedRightId] = useState<string | null>(null);

	const leftScans = scans.filter((s) => s.footSide === 'LEFT');
	const rightScans = scans.filter((s) => s.footSide === 'RIGHT');

	const handleLeftSelect = (scanId: string) => {
		setSelectedLeftId(scanId);
		onLeftSelect(scanId);
	};

	const handleRightSelect = (scanId: string) => {
		setSelectedRightId(scanId);
		onRightSelect(scanId);
	};

	const canContinue = selectedLeftId && selectedRightId;

	return (
		<div className="w-full max-w-4xl mx-auto">
			<Card>
				<CardHeader>
					<CardTitle className="text-2xl">Select STL Scans</CardTitle>
					<p className="text-gray-600 mt-2">
						Choose left and right foot scans to import
					</p>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 gap-6 mb-6">
						{/* Left Foot Selection */}
						<div>
							<h3 className="font-semibold mb-3 text-blue-600">Left Foot</h3>
							<div className="space-y-2">
								{leftScans.length > 0 ? (
									leftScans.map((scan) => (
										<button
											key={scan.id}
											onClick={() => handleLeftSelect(scan.id)}
											className={`
												w-full p-4 rounded-lg border-2 text-left transition-all
												${
													selectedLeftId === scan.id
														? 'border-blue-500 bg-blue-50 shadow-md'
														: 'border-gray-200 bg-white hover:border-gray-300'
												}
											`}
										>
											<div className="font-medium">Left Foot Scan</div>
											<div className="text-sm text-gray-500 mt-1">
												{scan.stlUrl.split('/').pop()}
											</div>
										</button>
									))
								) : (
									<div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-500">
										No left foot scans available
									</div>
								)}
							</div>
						</div>

						{/* Right Foot Selection */}
						<div>
							<h3 className="font-semibold mb-3 text-red-600">Right Foot</h3>
							<div className="space-y-2">
								{rightScans.length > 0 ? (
									rightScans.map((scan) => (
										<button
											key={scan.id}
											onClick={() => handleRightSelect(scan.id)}
											className={`
												w-full p-4 rounded-lg border-2 text-left transition-all
												${
													selectedRightId === scan.id
														? 'border-red-500 bg-red-50 shadow-md'
														: 'border-gray-200 bg-white hover:border-gray-300'
												}
											`}
										>
											<div className="font-medium">Right Foot Scan</div>
											<div className="text-sm text-gray-500 mt-1">
												{scan.stlUrl.split('/').pop()}
											</div>
										</button>
									))
								) : (
									<div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-500">
										No right foot scans available
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Continue Button */}
					<div className="flex justify-end">
						<Button
							size="lg"
							onClick={onContinue}
							disabled={!canContinue}
							className="min-w-32"
						>
							Continue →
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
