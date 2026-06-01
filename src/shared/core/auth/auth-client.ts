'use client';

import { createAuthClient } from 'better-auth/react';
import { resolveAppUrl } from './resolve-app-url';

export const authClient = createAuthClient({
	baseURL: resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL),
});

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
} = authClient;
