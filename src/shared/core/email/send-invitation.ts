import { resend, FROM_EMAIL } from './resend';
import { render } from '@react-email/components';
import { InvitationEmail } from './templates/invitation';

interface SendInvitationEmailParams {
	to: string;
	inviteUrl: string;
	orgName: string;
	inviterName: string;
	role: 'ADMIN' | 'DOCTOR';
	expiresInDays: number;
}

export async function sendInvitationEmail({
	to,
	inviteUrl,
	orgName,
	inviterName,
	role,
	expiresInDays,
}: SendInvitationEmailParams) {
	if (!resend) {
		console.warn('Resend is not configured. Email not sent.');
		return { success: false, error: 'Email service not configured' };
	}

	// For testing: Resend only allows sending to your verified email address
	// Check if we're in development and warn if sending to unverified email
	const isDevelopment = process.env.NODE_ENV === 'development';
	const verifiedTestEmail = process.env.RESEND_TEST_EMAIL;

	if (isDevelopment && verifiedTestEmail && to !== verifiedTestEmail) {
		console.warn(
			`⚠️  Resend Testing Mode: Can only send to verified email (${verifiedTestEmail}). ` +
				`Attempting to send to ${to} will fail. ` +
				`To send to other emails, verify a domain at resend.com/domains`
		);
	}

	try {
		const emailHtml = await render(
			InvitationEmail({
				inviteUrl,
				orgName,
				inviterName,
				role,
				expiresInDays,
			})
		);

		const { data, error } = await resend.emails.send({
			from: FROM_EMAIL,
			to,
			subject: `Uitnodiging voor ${orgName}`,
			html: emailHtml,
		});

		if (error) {
			console.error('Failed to send invitation email:', error);
			return { success: false, error: error.message };
		}

		return { success: true, id: data?.id };
	} catch (error) {
		console.error('Error sending invitation email:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}
