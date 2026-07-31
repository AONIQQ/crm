/**
 * Where the NestJS API lives.
 *
 * Public because the browser needs it for sign-in redirects; the server uses
 * the same value so there is only ever one origin to configure.
 */
export const API_URL =
	process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
