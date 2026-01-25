'use client';

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';
import { Button } from '@/src/shared/components/ui/button';
import { useState, useEffect } from 'react';
import { useDesignStore } from '@/src/shared/core/store/designStore';

interface STLFileInfo {
	filename: string;
	url: string;
	size: number;
	side: 'left' | 'right' | 'unknown';
}

interface BaseSTLSelectorProps {
	onSelect: (url: string) => void;
	onContinue?: () => void;
}

export function BaseSTLSelector({ onSelect, onContinue }: BaseSTLSelectorProps) {
	const [files, setFiles] = useState<STLFileInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
	const { setSelectedBaseSTL } = useDesignStore();

	useEffect(() => {
		const hardcodedFiles: STLFileInfo[] = [
			{
				filename: '(Amina) Ruymen - voor Dion_L.stl',
				url: '/base/(Amina) Ruymen - voor Dion_L.stl',
				size: 0,
				side: 'left',
			},
			{
				filename: '(Amina) Ruymen - voor Dion_R.stl',
				url: '/base/(Amina) Ruymen - voor Dion_R.stl',
				size: 0,
				side: 'right',
			},
		];
		setFiles(hardcodedFiles);
		setLoading(false);
	}, []);

	const handleSelect = (url: string) => {
		setSelectedUrl(url);
		setSelectedBaseSTL(url);
		onSelect(url);
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const getSideColor = (side: string) => {
		switch (side) {
			case 'left':
				return 'text-blue-600';
			case 'right':
				return 'text-red-600';
			default:
				return 'text-gray-600';
		}
	};

	if (loading) {
		return (
			<div className="w-full max-w-4xl mx-auto">
				<Card>
					<CardContent className="p-6">
						<div className="text-center text-gray-500">Loading STL files...</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="w-full max-w-4xl mx-auto">
			<Card>
				<CardHeader>
					<CardTitle className="text-2xl">Select Base STL File</CardTitle>
					<p className="text-gray-600 mt-2">
						Choose a base STL file from public/base to edit
					</p>
				</CardHeader>
				<CardContent>
					<div className="space-y-2 mb-6">
						{files.length > 0 ? (
							files.map((file) => (
								<button
									key={file.url}
									onClick={() => handleSelect(file.url)}
									className={`
										w-full p-4 rounded-lg border-2 text-left transition-all
										${
											selectedUrl === file.url
												? 'border-blue-500 bg-blue-50 shadow-md'
												: 'border-gray-200 bg-white hover:border-gray-300'
										}
									`}
								>
									<div className="flex items-center justify-between">
										<div className="flex-1">
											<div className="font-medium">{file.filename}</div>
											<div className="text-sm text-gray-500 mt-1 flex items-center gap-4">
												<span className={getSideColor(file.side)}>
													{file.side === 'unknown'
														? 'Side: Unknown'
														: `Side: ${file.side.toUpperCase()}`}
												</span>
												<span>Size: {formatFileSize(file.size)}</span>
											</div>
										</div>
										{selectedUrl === file.url && (
											<div className="ml-4 text-blue-500">✓</div>
										)}
									</div>
								</button>
							))
						) : (
							<div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-500">
								No STL files found in public/base
							</div>
						)}
					</div>

					{onContinue && (
						<div className="flex justify-end">
							<Button
								size="lg"
								onClick={onContinue}
								disabled={!selectedUrl}
								className="min-w-32"
							>
								Continue →
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
