import { NextResponse } from 'next/server';
import fs from 'fs';

/**
 * GET /api/printer/config
 * Returns the printer configuration status (whether ideaMaker and RaiseCloud are configured)
 */
export async function GET() {
	const ideaMakerPath = process.env.IDEAMAKER_PATH || '';
	const raiseCloudApiKey = process.env.RAISECLOUD_API_KEY || '';
	const raiseCloudApiSecret = process.env.RAISECLOUD_API_SECRET || '';

	// Check if ideaMaker executable exists
	let ideaMakerConfigured = false;
	if (ideaMakerPath) {
		try {
			ideaMakerConfigured = fs.existsSync(ideaMakerPath);
		} catch {
			ideaMakerConfigured = false;
		}
	}

	// Check if RaiseCloud credentials are set
	const raiseCloudConfigured = Boolean(raiseCloudApiKey && raiseCloudApiSecret);

	return NextResponse.json({
		ideaMaker: {
			configured: ideaMakerConfigured,
			path: ideaMakerPath ? '(configured)' : '(not set)',
		},
		raiseCloud: {
			configured: raiseCloudConfigured,
		},
	});
}
