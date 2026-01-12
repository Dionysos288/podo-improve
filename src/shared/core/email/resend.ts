import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
	console.warn(
		'RESEND_API_KEY is not set. Email functionality will be disabled.'
	);
}

export const resend = process.env.RESEND_API_KEY
	? new Resend(process.env.RESEND_API_KEY)
	: null;

// For testing: Use your verified email address
// For production: Use an email from a verified domain (e.g., noreply@yourdomain.com)
export const FROM_EMAIL =
	process.env.RESEND_FROM_EMAIL || 'zenelidion288@gmail.com';
