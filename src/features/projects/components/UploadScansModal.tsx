'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/src/shared/components/ui/button';
import { Input } from '@/src/shared/components/ui/input';
import { Upload, X, FileBox, Check, Loader2 } from 'lucide-react';

interface UploadScansModalProps {
	open: boolean;
	onClose: () => void;
	projectId: string;
	onUploadComplete?: (scans: Array<{ id: string; footSide: string; stlUrl: string; name: string; pairId: string }>) => void;
}

export function UploadScansModal({
	open,
	onClose,
	projectId,
	onUploadComplete,
}: UploadScansModalProps) {
	const [scanName, setScanName] = useState('');
	const [leftFile, setLeftFile] = useState<File | null>(null);
	const [rightFile, setRightFile] = useState<File | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uploadProgress, setUploadProgress] = useState<{
		left: 'idle' | 'uploading' | 'done' | 'error';
		right: 'idle' | 'uploading' | 'done' | 'error';
	}>({ left: 'idle', right: 'idle' });
	const leftInputRef = useRef<HTMLInputElement>(null);
	const rightInputRef = useRef<HTMLInputElement>(null);

	const handleDrop = useCallback(
		(side: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			const file = e.dataTransfer.files[0];
			if (file && (file.name.endsWith('.stl') || file.name.endsWith('.STL'))) {
				if (side === 'left') setLeftFile(file);
				else setRightFile(file);
				setError(null);
			} else {
				setError('Alleen STL bestanden zijn toegestaan');
			}
		},
		[]
	);

	const handleFileSelect = useCallback(
		(side: 'left' | 'right') => (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				if (side === 'left') setLeftFile(file);
				else setRightFile(file);
				setError(null);
			}
		},
		[]
	);

	const uploadScan = async (file: File, footSide: 'LEFT' | 'RIGHT', name: string, pairId: string) => {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('footSide', footSide);
		formData.append('name', name);
		formData.append('pairId', pairId);

		const response = await fetch(`/api/projects/${projectId}/scans`, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || `Upload mislukt (${footSide})`);
		}

		return response.json();
	};

	const handleSubmit = async () => {
		if (!scanName.trim()) {
			setError('Vul een naam in voor de scan');
			return;
		}
		if (!leftFile && !rightFile) {
			setError('Selecteer minstens één STL bestand');
			return;
		}

		setIsUploading(true);
		setError(null);
		const uploadedScans: Array<{ id: string; footSide: string; stlUrl: string; name: string; pairId: string }> = [];
		// Generate a shared pairId so left + right are grouped
		const pairId = crypto.randomUUID();
		const trimmedName = scanName.trim();

		try {
			if (leftFile) {
				setUploadProgress((prev) => ({ ...prev, left: 'uploading' }));
				const scan = await uploadScan(leftFile, 'LEFT', trimmedName, pairId);
				uploadedScans.push({ id: scan.id, footSide: 'left', stlUrl: scan.stlUrl, name: trimmedName, pairId });
				setUploadProgress((prev) => ({ ...prev, left: 'done' }));
			}

			if (rightFile) {
				setUploadProgress((prev) => ({ ...prev, right: 'uploading' }));
				const scan = await uploadScan(rightFile, 'RIGHT', trimmedName, pairId);
				uploadedScans.push({ id: scan.id, footSide: 'right', stlUrl: scan.stlUrl, name: trimmedName, pairId });
				setUploadProgress((prev) => ({ ...prev, right: 'done' }));
			}

			onUploadComplete?.(uploadedScans);

			// Reset and close
			setTimeout(() => {
				setScanName('');
				setLeftFile(null);
				setRightFile(null);
				setUploadProgress({ left: 'idle', right: 'idle' });
				onClose();
			}, 800);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Upload mislukt');
			setUploadProgress((prev) => ({
				left: prev.left === 'uploading' ? 'error' : prev.left,
				right: prev.right === 'uploading' ? 'error' : prev.right,
			}));
		} finally {
			setIsUploading(false);
		}
	};

	const handleClose = () => {
		if (isUploading) return;
		setScanName('');
		setLeftFile(null);
		setRightFile(null);
		setError(null);
		setUploadProgress({ left: 'idle', right: 'idle' });
		onClose();
	};

	if (!open) return null;

	const renderDropZone = (
		side: 'left' | 'right',
		label: string,
		file: File | null,
		inputRef: React.RefObject<HTMLInputElement | null>,
		status: 'idle' | 'uploading' | 'done' | 'error'
	) => (
		<div className="flex-1">
			<label className="mb-2 block text-xs font-medium uppercase tracking-wide text-ui-muted">
				{label}
			</label>
			<div
				onDragOver={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
				onDrop={handleDrop(side)}
				onClick={() => inputRef.current?.click()}
				className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-all ${
					file
						? status === 'done'
							? 'border-green-500/50 bg-green-500/5'
							: status === 'error'
								? 'border-red-500/50 bg-red-500/5'
								: 'border-ui-accent/50 bg-ui-accent/5'
						: 'border-ui-border hover:border-ui-accent/50 hover:bg-ui-overlay/30'
				}`}
			>
				<input
					ref={inputRef}
					type="file"
					accept=".stl"
					onChange={handleFileSelect(side)}
					className="hidden"
				/>
				{status === 'uploading' ? (
					<>
						<Loader2 className="mb-2 h-8 w-8 animate-spin text-ui-accent" />
						<p className="text-sm text-ui-accent">Uploaden...</p>
					</>
				) : status === 'done' ? (
					<>
						<Check className="mb-2 h-8 w-8 text-green-400" />
						<p className="text-sm text-green-400">Geüpload</p>
					</>
				) : file ? (
					<>
						<FileBox className="mb-2 h-8 w-8 text-ui-accent" />
						<p className="max-w-full truncate text-sm font-medium text-foreground">
							{file.name}
						</p>
						<p className="mt-1 text-xs text-ui-muted">
							{(file.size / 1024 / 1024).toFixed(1)} MB
						</p>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								if (side === 'left') setLeftFile(null);
								else setRightFile(null);
							}}
							className="absolute right-2 top-2 rounded-lg p-1 text-ui-muted transition-colors hover:bg-ui-overlay hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					</>
				) : (
					<>
						<Upload className="mb-2 h-8 w-8 text-ui-muted" />
						<p className="text-sm font-medium text-foreground">
							Sleep STL bestand hierheen
						</p>
						<p className="mt-1 text-xs text-ui-muted">of klik om te selecteren</p>
					</>
				)}
			</div>
		</div>
	);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
			<div className="w-full max-w-2xl rounded-2xl border border-ui-border bg-ui-panel p-8 shadow-2xl">
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-2xl font-bold text-foreground">Scans uploaden</h2>
					<button
						type="button"
						onClick={handleClose}
						disabled={isUploading}
						className="rounded-lg p-2 text-ui-muted transition-colors hover:bg-ui-overlay hover:text-foreground disabled:opacity-50"
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				{/* Scan name input */}
				<div className="mb-6 space-y-2">
					<label className="text-xs font-medium uppercase tracking-wide text-ui-muted">
						Scannaam
					</label>
					<Input
						type="text"
						value={scanName}
						onChange={(e) => setScanName(e.target.value)}
						placeholder="Bijv. Eerste scan, Controle scan..."
						className="w-full rounded-xl border border-ui-border bg-ui-card px-4 py-3 text-foreground placeholder:text-ui-muted focus:border-ui-accent focus:outline-none focus:ring-2 focus:ring-ui-accent/20"
					/>
				</div>

				{/* Drop zones */}
				<div className="mb-6 flex gap-4">
					{renderDropZone('left', 'Linkervoet (L)', leftFile, leftInputRef, uploadProgress.left)}
					{renderDropZone('right', 'Rechtervoet (R)', rightFile, rightInputRef, uploadProgress.right)}
				</div>

				{/* Error */}
				{error && (
					<div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
						{error}
					</div>
				)}

				{/* Actions */}
				<div className="flex gap-3">
					<Button
						type="button"
						onClick={handleClose}
						disabled={isUploading}
						variant="outline"
						className="flex-1 rounded-xl border border-ui-border py-3 font-medium text-foreground transition-colors hover:bg-ui-overlay"
					>
						Annuleren
					</Button>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={isUploading || (!leftFile && !rightFile)}
						className="flex-1 rounded-xl bg-ui-accent py-3 font-semibold text-slate-900 transition-colors disabled:opacity-50"
					>
						{isUploading ? (
							<span className="flex items-center justify-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								Uploaden...
							</span>
						) : (
							<span className="flex items-center justify-center gap-2">
								<Upload className="h-4 w-4" />
								Upload scans
							</span>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
