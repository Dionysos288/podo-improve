import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/src/shared/core/db/prisma';

export const auth = betterAuth({
	database: prismaAdapter(prisma, {
		provider: 'postgresql',
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false, // Set to true in production with email configured
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || '',
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
			enabled: !!process.env.GOOGLE_CLIENT_ID,
		},
		microsoft: {
			clientId: process.env.MICROSOFT_CLIENT_ID || '',
			clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
			enabled: !!process.env.MICROSOFT_CLIENT_ID,
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day
		cookieCache: {
			enabled: true,
			maxAge: 60 * 5, // 5 minutes
		},
	},
	user: {
		additionalFields: {
			orgId: {
				type: 'string',
				required: false,
			},
			role: {
				type: 'string',
				required: false,
				defaultValue: 'DOCTOR',
			},
		},
	},
	trustedOrigins: [process.env.BETTER_AUTH_URL || 'http://localhost:3000'],
});

export type Session = typeof auth.$Infer.Session;
