import { type Db, EnrichmentStatus } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { domainFromEmail } from "./domain";

/**
 * "Which company does this address belong to?" — the CRM half of a question
 * that used to be half enrichment.
 *
 * The old `EnrichmentService.companyForEmail` called Context.dev *inside the
 * request* so a new company could arrive already named "Stripe" rather than
 * "stripe.com". That was a nice touch bought at a bad price: a vendor lookup on
 * the path of every contact create and every sync tick, in the layer that is
 * not allowed to know vendors exist.
 *
 * So this does the part that is genuinely ours — find or create by domain — and
 * tells the agent a bare company now exists. The name is the domain for the few
 * seconds it takes the agent to replace it, and the sheet polls, which it
 * already did.
 */
@Injectable()
export class CompanyDirectoryService {
	private readonly logger = new Logger(CompanyDirectoryService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async companyForEmail(
		email: string,
		options: { ownerId?: string | null } = {},
	): Promise<string | null> {
		const domain = domainFromEmail(email);
		if (!domain) return null;

		const existing = await this.db.company.findUnique({
			where: { domain },
			select: { id: true },
		});
		if (existing) return existing.id;

		// Two contacts at a new company can race here; the unique index on
		// `domain` is what actually settles it.
		const company = await this.db.company.upsert({
			where: { domain },
			create: {
				name: domain,
				domain,
				website: `https://${domain}`,
				enrichmentStatus: EnrichmentStatus.PENDING,
				// An unowned company is nobody's job. Whoever's action produced it
				// owns it until someone reassigns.
				ownerId: options.ownerId ?? null,
			},
			update: {},
			select: { id: true },
		});

		await this.agent.companyCreated(
			company.id,
			`Created from an email domain (${domain}) — it has no name but the domain`,
		);

		this.logger.log({
			message: "Company created from an email domain",
			companyId: company.id,
			domain,
		});

		return company.id;
	}
}
