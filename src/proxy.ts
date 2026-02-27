import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public routes that don't require authentication
const publicRoutes = ['/login', '/register', '/join'];

// API routes should be excluded from redirect middleware.
// API handlers perform their own auth checks and should return JSON errors,
// not HTML redirects.
const excludedRoutes = ['/api'];

export default async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Skip middleware for static files and excluded routes
	if (
		pathname.startsWith('/_next') ||
		pathname.startsWith('/favicon') ||
		pathname.includes('.') ||
		excludedRoutes.some((route) => pathname.startsWith(route))
	) {
		return NextResponse.next();
	}

	// Check if the route is public
	const isPublicRoute = publicRoutes.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`)
	);

	// Get the session token from cookies
	const sessionToken = request.cookies.get('better-auth.session_token')?.value;
	const isAuthenticated = !!sessionToken;

	// Redirect unauthenticated users to login
	if (!isAuthenticated && !isPublicRoute && pathname !== '/') {
		const loginUrl = new URL('/login', request.url);
		loginUrl.searchParams.set('callbackUrl', pathname);
		return NextResponse.redirect(loginUrl);
	}

	// Redirect authenticated users away from auth pages
	if (isAuthenticated && isPublicRoute) {
		return NextResponse.redirect(new URL('/', request.url));
	}

	// Handle root redirect for authenticated users
	if (isAuthenticated && pathname === '/') {
		// We need to get the user's organization from the database
		// Since we can't easily access Prisma in Edge middleware,
		// we'll redirect to a server-side route that handles this
		return NextResponse.redirect(new URL('/redirect', request.url));
	}

	// Add pathname to headers so layouts can read it
	const response = NextResponse.next();
	response.headers.set('x-pathname', pathname);
	return response;
}

export const config = {
	matcher: [
		/*
		 * Match all request paths except for the ones starting with:
		 * - _next/static (static files)
		 * - _next/image (image optimization files)
		 * - favicon.ico (favicon file)
		 * - public folder files
		 */
		'/((?!_next/static|_next/image|favicon.ico|.*\\..*|STL|models|base).*)',
	],
};
