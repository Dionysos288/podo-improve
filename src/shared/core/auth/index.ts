// Server-side auth (use in server components and API routes)
export { auth } from './auth';
export type { Session } from './auth';

// Client-side auth hooks and utilities
export {
	authClient,
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
} from './auth-client';
