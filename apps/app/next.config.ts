import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The @crm/* packages are just-in-time: they ship TypeScript sources, so
	// Next has to compile them rather than treat them as prebuilt dependencies.
	transpilePackages: ["@crm/auth", "@crm/db", "@crm/ui"],

	// Prisma's runtime and the pg driver are Node-only and resolve files at
	// runtime; bundling them breaks that. @crm/db itself is still transpiled.
	serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

	images: {
		remotePatterns: [
			// Google account avatars, which arrive as `user.image`.
			{ protocol: "https", hostname: "lh3.googleusercontent.com" },
		],
	},

	experimental: {
		// The app shell uses `view-transition-name` and <Link transitionTypes>.
		viewTransition: true,
	},
};

export default nextConfig;
