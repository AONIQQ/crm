import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	@IsString()
	@MinLength(1)
	DATABASE_URL!: string;

	@IsString()
	@MinLength(32, {
		message:
			"BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32).",
	})
	BETTER_AUTH_SECRET!: string;

	@IsUrl({ require_tld: false })
	BETTER_AUTH_URL!: string;

	@IsOptional()
	@IsString()
	AUTH_TRUSTED_ORIGINS?: string;

	// Google is the only way in, so unlike @crm/auth — which stays loadable
	// without credentials for `better-auth generate` — the process that serves
	// the auth routes refuses to start without them.
	@IsString()
	@MinLength(1, {
		message:
			"GOOGLE_CLIENT_ID is required — Google is the only sign-in method. Create an OAuth client ID in the Google Cloud console.",
	})
	GOOGLE_CLIENT_ID!: string;

	@IsString()
	@MinLength(1, { message: "GOOGLE_CLIENT_SECRET is required." })
	GOOGLE_CLIENT_SECRET!: string;

	/** Parent domain for session cookies when the API and app differ. */
	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@IsString()
	REDIS_URL?: string;

	/**
	 * Context.dev, for company enrichment. Optional: without it the agent is
	 * disabled, a warning is logged once at boot, and companies stay `PENDING`.
	 * Server-side only — it never reaches the browser.
	 */
	@IsOptional()
	@IsString()
	CONTEXT_DEV_API_KEY?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;
}

export function validateEnv(
	config: Record<string, unknown>,
): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});

	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});

	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");
		throw new Error(`Invalid environment configuration:\n  - ${details}`);
	}

	return validated;
}
