import { Injectable, Logger } from "@nestjs/common";
import { AfterUpdate, DatabaseHook } from "@thallesp/nestjs-better-auth";
import { AuthService } from "./auth.service";

/**
 * Cached profiles are bounded by TTL; this drops one the moment its row
 * changes, so a rename never lingers for five minutes.
 *
 * A database hook rather than an endpoint hook: Better Auth also writes to
 * `user` when Google reports a changed name or avatar at sign-in, and that
 * never goes through `/update-user`.
 */
@DatabaseHook()
@Injectable()
export class AuthHooksService {
	private readonly logger = new Logger(AuthHooksService.name);

	constructor(private readonly authService: AuthService) {}

	@AfterUpdate("user")
	async onUserUpdated(user: { id: string }): Promise<void> {
		try {
			await this.authService.invalidateProfile(user.id);
		} catch (error) {
			// This runs inside Better Auth's write pipeline: throwing here would
			// fail the update itself. A stale profile expires on its own within
			// the TTL, so log it and let the write stand.
			this.logger.error(
				{ message: "Failed to invalidate cached profile", userId: user.id },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}
}
