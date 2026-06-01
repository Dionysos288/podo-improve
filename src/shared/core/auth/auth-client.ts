'use client';

import { createAuthClient } from 'better-auth/react';
import { resolveAppUrl } from './resolve-app-url';

function getAuthClientBaseURL(): string {
	if (typeof window !== 'undefined') {
		return window.location.origin;
	}
	return resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
}

export const authClient = createAuthClient({
	baseURL: getAuthClientBaseURL(),
});

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
} = authClient;
