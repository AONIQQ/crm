import type { Db } from "@crm/db";
import { resolveFavicon } from "@crm/db/favicon";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Stores the domain's own favicon as a stand-in icon.
 *
 * The resolving is in `@crm/db/favicon`, shared with the seed. This is only the
 * write, and the write is the part with a rule in it: the agent's Context.dev
 * icon is the curated one and always wins, so ours is never allowed to replace
 * it, and the agent is free to replace ours (see `brandToUpdate`).
 *
 * Sitting in the API at all is a deliberate exception to `docs/api.md`: there
 * is nothing here to decide. No vendor, no key, no matching, no scoring — so
 * there is no second judgement that can drift from the agent's, which is the
 * failure that rule exists to prevent.
 */
@Injectable()
export class FaviconService {
	private readonly logger = new Logger(FaviconService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * Resolve and store, without ever throwing at the caller.
	 *
	 * Callers fire this and move on, so a rejected promise here would be an
	 * unhandled one. A company with no icon is the state we are already in.
	 */
	async backfill(companyId: string, domain: string | null): Promise<boolean> {
		try {
			const iconUrl = await resolveFavicon(domain);
			if (!iconUrl) return false;

			// `iconUrl: null` in the filter, so an icon the agent found while we
			// were fetching is never overwritten by ours.
			const { count } = await this.db.company.updateMany({
				where: { id: companyId, iconUrl: null },
				data: { iconUrl },
			});

			if (count > 0) {
				this.logger.log({ message: "Favicon resolved", companyId, iconUrl });
			}

			return count > 0;
		} catch (error) {
			this.logger.debug({
				message: "Favicon lookup failed",
				companyId,
				domain,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}
}
