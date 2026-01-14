import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * POST /api/printer/gcode
 * Generate Gcode from an STL file using ideaMaker CLI
 *
 * Request body: { stlData: base64 encoded STL file }
 * Returns: { success: boolean, gcodeUrl?: string, error?: string }
 */
export async function POST(request: NextRequest) {
	const ideaMakerPath = process.env.IDEAMAKER_PATH;

	if (!ideaMakerPath) {
		return NextResponse.json(
			{
				success: false,
				error:
					'ideaMaker is not configured. Set IDEAMAKER_PATH environment variable.',
			},
			{ status: 400 }
		);
	}

	// Check if ideaMaker exists
	if (!fs.existsSync(ideaMakerPath)) {
		return NextResponse.json(
			{
				success: false,
				error: `ideaMaker executable not found at: ${ideaMakerPath}`,
			},
			{ status: 400 }
		);
	}

	try {
		const body = await request.json();
		const { stlData, filename = 'insole.stl' } = body;

		if (!stlData) {
			return NextResponse.json(
				{ success: false, error: 'No STL data provided' },
				{ status: 400 }
			);
		}

		// Create temp directory for processing
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podo-gcode-'));
		const stlPath = path.join(tempDir, filename);
		const gcodePath = path.join(tempDir, filename.replace('.stl', '.gcode'));

		// Write STL to temp file
		const stlBuffer = Buffer.from(stlData, 'base64');
		fs.writeFileSync(stlPath, stlBuffer);

		// Run ideaMaker CLI
		// Note: ideaMaker CLI arguments may need adjustment based on actual CLI documentation
		// This is a placeholder implementation
		return new Promise<Response>((resolve) => {
			const ideamaker = spawn(ideaMakerPath, [
				'--slice',
				'--input',
				stlPath,
				'--output',
				gcodePath,
				// Add printer profile, material settings, etc.
			]);

			let stderr = '';

			ideamaker.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			ideamaker.on('close', (code) => {
				if (code !== 0) {
					// Clean up
					fs.rmSync(tempDir, { recursive: true, force: true });
					resolve(
						NextResponse.json(
							{
								success: false,
								error: `ideaMaker exited with code ${code}: ${stderr}`,
							},
							{ status: 500 }
						)
					);
					return;
				}

				// Read generated gcode
				if (fs.existsSync(gcodePath)) {
					const gcodeData = fs.readFileSync(gcodePath, 'base64');

					// Clean up
					fs.rmSync(tempDir, { recursive: true, force: true });

					resolve(
						NextResponse.json({
							success: true,
							gcodeData,
							filename: filename.replace('.stl', '.gcode'),
						})
					);
				} else {
					fs.rmSync(tempDir, { recursive: true, force: true });
					resolve(
						NextResponse.json(
							{ success: false, error: 'Gcode file was not generated' },
							{ status: 500 }
						)
					);
				}
			});

			ideamaker.on('error', (err) => {
				fs.rmSync(tempDir, { recursive: true, force: true });
				resolve(
					NextResponse.json(
						{
							success: false,
							error: `Failed to run ideaMaker: ${err.message}`,
						},
						{ status: 500 }
					)
				);
			});
		});
	} catch (error) {
		console.error('Error generating Gcode:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 }
		);
	}
}
