'use client';

import { Button } from '@/src/shared/components/ui/button';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { useDesignStore } from '@/src/shared/core/store/designStore';

interface MatchingControlsProps {
	onMatch: () => void;
	onReset: () => void;
	isMatching: boolean;
}

export function MatchingControls({
	onMatch,
	onReset,
	isMatching,
}: MatchingControlsProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Matching</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm text-gray-600">
					Align and match left and right foot scans
				</p>
				<div className="space-y-2">
					<Button onClick={onMatch} disabled={isMatching} className="w-full">
						{isMatching ? 'Matching...' : 'Auto Match Feet'}
					</Button>
					<Button onClick={onReset} variant="outline" className="w-full">
						Reset Position
					</Button>
				</div>
				<div className="pt-2 border-t">
					<p className="text-xs text-gray-500 mb-2">Manual Adjustments:</p>
					<div className="grid grid-cols-2 gap-2 text-xs">
						<div>
							<label className="block text-gray-600 mb-1">X Offset</label>
							<input
								type="range"
								min="-100"
								max="100"
								defaultValue="0"
								className="w-full"
							/>
						</div>
						<div>
							<label className="block text-gray-600 mb-1">Y Offset</label>
							<input
								type="range"
								min="-100"
								max="100"
								defaultValue="0"
								className="w-full"
							/>
						</div>
						<div>
							<label className="block text-gray-600 mb-1">Z Offset</label>
							<input
								type="range"
								min="-100"
								max="100"
								defaultValue="0"
								className="w-full"
							/>
						</div>
						<div>
							<label className="block text-gray-600 mb-1">Scale</label>
							<input
								type="range"
								min="0.5"
								max="2"
								step="0.1"
								defaultValue="1"
								className="w-full"
							/>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
