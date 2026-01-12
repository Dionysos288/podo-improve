import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Link,
	Preview,
	Section,
	Text,
} from '@react-email/components';
import * as React from 'react';

interface InvitationEmailProps {
	inviteUrl: string;
	orgName: string;
	inviterName: string;
	role: string;
	expiresInDays: number;
}

export function InvitationEmail({
	inviteUrl,
	orgName,
	inviterName,
	role,
	expiresInDays,
}: InvitationEmailProps) {
	const roleLabel = role === 'ADMIN' ? 'Beheerder' : 'Behandelaar';

	return (
		<Html>
			<Head />
			<Preview>
				Je bent uitgenodigd om lid te worden van {orgName} als {roleLabel}
			</Preview>
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Uitnodiging voor {orgName}</Heading>
					<Text style={text}>Hallo,</Text>
					<Text style={text}>
						{inviterName} heeft je uitgenodigd om lid te worden van{' '}
						<strong>{orgName}</strong> als <strong>{roleLabel}</strong>.
					</Text>
					<Section style={buttonContainer}>
						<Button style={button} href={inviteUrl}>
							Accepteer uitnodiging
						</Button>
					</Section>
					<Text style={text}>Of kopieer en plak deze link in je browser:</Text>
					<Link href={inviteUrl} style={link}>
						{inviteUrl}
					</Link>
					<Text style={text}>
						Deze uitnodiging verloopt over {expiresInDays} dag
						{expiresInDays !== 1 ? 'en' : ''}.
					</Text>
					<Text style={footer}>
						Als je deze uitnodiging niet hebt aangevraagd, kun je dit bericht
						negeren.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

const main = {
	backgroundColor: '#f6f9fc',
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
	backgroundColor: '#ffffff',
	margin: '0 auto',
	padding: '20px 0 48px',
	marginBottom: '64px',
};

const h1 = {
	color: '#333',
	fontSize: '24px',
	fontWeight: 'bold',
	margin: '40px 0',
	padding: '0',
};

const text = {
	color: '#333',
	fontSize: '16px',
	lineHeight: '26px',
};

const buttonContainer = {
	padding: '27px 0 27px',
};

const button = {
	backgroundColor: '#5F51E8',
	borderRadius: '8px',
	color: '#fff',
	fontSize: '16px',
	fontWeight: 'bold',
	textDecoration: 'none',
	textAlign: 'center' as const,
	display: 'block',
	padding: '12px 24px',
};

const link = {
	color: '#5F51E8',
	textDecoration: 'underline',
};

const footer = {
	color: '#898989',
	fontSize: '12px',
	lineHeight: '22px',
	marginTop: '12px',
	textAlign: 'left' as const,
};

export default InvitationEmail;
