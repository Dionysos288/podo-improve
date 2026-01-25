import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

interface STLFileInfo {
	filename: string;
	url: string;
	size: number;
	side: 'left' | 'right' | 'unknown';
}

function detectSide(filename: string): 'left' | 'right' | 'unknown' {
	const lower = filename.toLowerCase();
	if (lower.includes('_l') || lower.includes('_left') || lower.includes('l.stl')) {
		return 'left';
	}
	if (lower.includes('_r') || lower.includes('_right') || lower.includes('r.stl')) {
		return 'right';
	}
	return 'unknown';
}

export async function GET() {
	try {
		const baseDir = join(process.cwd(), 'public', 'base');
		const files = await readdir(baseDir);

		const stlFiles: STLFileInfo[] = [];

		for (const file of files) {
			if (!file.toLowerCase().endsWith('.stl')) {
				continue;
			}

			const filePath = join(baseDir, file);
			const stats = await stat(filePath);

			stlFiles.push({
				filename: file,
				url: `/base/${file}`,
				size: stats.size,
				side: detectSide(file),
			});
		}

		return NextResponse.json({ files: stlFiles });
	} catch (error) {
		console.error('Error reading STL files:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to read STL files',
			},
			{ status: 500 }
		);
	}
}
