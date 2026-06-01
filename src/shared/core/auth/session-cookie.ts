/** Cookie names Better Auth uses (http vs https). */
const SESSION_COOKIE_NAMES = [
	'__Secure-better-auth.session_token',
	'better-auth.session_token',
] as const;

export function hasSessionCookie(
	cookies: { get: (name: string) => { value: string } | undefined },
): boolean {
	return SESSION_COOKIE_NAMES.some((name) => Boolean(cookies.get(name)?.value));
}
