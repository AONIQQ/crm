import { ActivityType, type Db, EnrichmentStatus } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { brandToUpdate, filledFields } from "./brand-mapping";
import { ContextDevClient } from "./context-dev.client";
import { EnrichmentQueue } from "./enrichment.queue";

/** The shape the research brief is extracted into. */
const RESEARCH_SCHEMA = {
	type: "object",
	properties: {
		positioning: {
			type: "string",
			description: "One paragraph: what they sell and who to.",
		},
		pricingModel: {
			type: "string",
			description: "How they charge — per seat, usage, flat, enterprise-only.",
		},
		targetCustomer: {
			type: "string",
			description: "The customer they describe themselves as serving.",
		},
		notableCustomers: {
			type: "array",
			items: { type: "string" },
			description: "Named customers or logos on the site.",
		},
		recentNews: {
			type: "array",
			items: { type: "string" },
			description: "Recent announcements, funding, or launches.",
		},
	},
	required: ["positioning"],
} as const;

const RESEARCH_INSTRUCTIONS =
	"Read this company's marketing site and answer as a salesperson preparing " +
	"for a first call. Be specific and factual; leave a field empty rather than " +
	"guessing.";

@Injectable()
export class EnrichmentService {
	private readonly logger = new Logger(EnrichmentService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly context: ContextDevClient,
		private readonly queue: EnrichmentQueue,
		private readonly stamp: ActivityStampService,
	) {}

	/**
	 * Queues a company for enrichment.
	 *
	 * Fire-and-forget by design: a cold Context.dev lookup is p50 ≈ 7s, and a
	 * "New company" form that sits spinning for seven seconds is a form people
	 * stop using. The detail page polls while the status is `PENDING`/`RUNNING`.
	 */
	enqueueCompany(
		companyId: string,
		options: { force?: boolean } = {},
	): boolean {
		if (!this.context.enabled) return false;

		return this.queue.enqueue(`company:${companyId}`, () =>
			this.runCompany(companyId, options.force ?? false),
		);
	}

	/** Whether the agent has an API key at all. */
	get enabled(): boolean {
		return this.context.enabled;
	}

	/** Waits for queued work — used by scripts and tests, not by request paths. */
	async drain(): Promise<void> {
		await this.queue.drain();
	}

	private async runCompany(companyId: string, force: boolean): Promise<void> {
		const company = await this.db.company.findUnique({
			where: { id: companyId },
			select: {
				id: true,
				name: true,
				domain: true,
				description: true,
				logoUrl: true,
				logoDarkUrl: true,
				iconUrl: true,
				iconDarkUrl: true,
				iconTone: true,
				brandColor: true,
				industry: true,
				subIndustry: true,
				city: true,
				stateCode: true,
				country: true,
				countryCode: true,
				phone: true,
				email: true,
				linkedinUrl: true,
				twitterUrl: true,
				githubUrl: true,
				pricingUrl: true,
				careersUrl: true,
			},
		});

		if (!company) return;

		const domain = normalizeDomain(company.domain);

		if (!domain) {
			await this.settle(
				companyId,
				EnrichmentStatus.SKIPPED,
				"No domain to look up.",
			);
			return;
		}

		await this.db.company.update({
			where: { id: companyId },
			data: {
				enrichmentStatus: EnrichmentStatus.RUNNING,
				enrichmentError: null,
			},
		});

		// Free, and turns a cold 7s lookup into a warm sub-second one.
		await this.context.prefetch(domain);

		// `maxAgeMs: 0` on a manual re-enrich: the whole point of pressing the
		// button is to get past the ~90-day server-side cache.
		const result = await this.context.brandByDomain(
			domain,
			force ? 0 : undefined,
		);

		if (result.outcome === "skipped") {
			await this.settle(companyId, EnrichmentStatus.SKIPPED, result.reason);
			return;
		}

		if (result.outcome === "failed") {
			await this.settle(companyId, EnrichmentStatus.FAILED, result.reason);
			// Let the queue's retry have a go at the retryable ones.
			if (result.retryable) throw new Error(result.reason);
			return;
		}

		const update = brandToUpdate(result.brand, {
			...company,
			// A company created from a domain alone is named after it until the
			// lookup tells us better.
			nameIsPlaceholder: company.name === domain,
		});

		await this.db.$transaction([
			this.db.company.update({
				where: { id: companyId },
				data: {
					...update,
					enrichmentStatus: EnrichmentStatus.COMPLETE,
					enrichedAt: new Date(),
					enrichmentError: null,
				},
			}),
			// The whole payload is kept so re-deriving a field later costs nothing
			// and no credits.
			this.db.companyEnrichment.upsert({
				where: { companyId },
				create: {
					companyId,
					raw: result.raw as never,
				},
				update: { raw: result.raw as never, fetchedAt: new Date() },
			}),
		]);

		this.logger.log({
			message: "Company enriched",
			companyId,
			domain,
			filled: filledFields(update),
		});
	}

	/**
	 * Finds or creates the company a work email belongs to.
	 *
	 * Called when a contact is added with a work address and no company. Returns
	 * the company id when one was found or made, `null` when the address says
	 * nothing useful (a personal or throwaway domain).
	 */
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

		if (!this.context.enabled) return null;

		const result = await this.context.brandByEmail(email);
		if (result.outcome !== "found") {
			this.logger.debug({
				message: "No company for email domain",
				domain,
				reason: result.reason,
			});
			return null;
		}

		const name = result.brand.title?.trim() || domain;

		// Two contacts at a new company can race here; the unique index on
		// `domain` is what actually settles it.
		const company = await this.db.company.upsert({
			where: { domain },
			create: {
				name,
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

		// Created from a lookup we already have — apply it rather than paying for
		// the same brand twice.
		this.enqueueCompany(company.id);

		this.logger.log({
			message: "Company created from a contact's email domain",
			companyId: company.id,
			domain,
		});

		return company.id;
	}

	/**
	 * Reads the company's site and posts what it found to the timeline.
	 *
	 * On the timeline rather than in a side panel because that is where a rep is
	 * already looking, and because it should age like everything else — a brief
	 * from six months ago is context, not current truth.
	 */
	async researchCompany(companyId: string, actingUserId: string) {
		const company = await this.db.company.findUnique({
			where: { id: companyId },
			select: { id: true, name: true, domain: true, website: true },
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${companyId}.`);
		}

		const url =
			company.website ?? (company.domain ? `https://${company.domain}` : null);

		if (!url) {
			return { ok: false as const, reason: "This company has no website yet." };
		}

		const result = await this.context.extract(
			url,
			RESEARCH_SCHEMA as unknown as Record<string, unknown>,
			RESEARCH_INSTRUCTIONS,
		);

		if (result.outcome === "failed") {
			return { ok: false as const, reason: result.reason };
		}

		const activity = await this.db.activity.create({
			data: {
				type: ActivityType.ENRICHMENT,
				subject: `Research brief — ${company.name}`,
				body: formatBrief(result.data),
				occurredAt: new Date(),
				companyId: company.id,
				createdById: actingUserId,
				meta: {
					source: "context.dev",
					endpoint: "web/extract",
					creditCost: 10,
				},
			},
			select: { id: true },
		});

		await this.stamp.touch({ companyId: company.id }, new Date());

		this.logger.log({
			message: "Research brief written",
			companyId,
			activityId: activity.id,
		});

		return { ok: true as const, activityId: activity.id };
	}

	private async settle(
		companyId: string,
		status: EnrichmentStatus,
		reason: string,
	): Promise<void> {
		await this.db.company.update({
			where: { id: companyId },
			data: {
				enrichmentStatus: status,
				enrichedAt: new Date(),
				// Only a real failure is worth surfacing; "nothing to find" is a
				// settled answer, not an error message to show a rep.
				enrichmentError: status === EnrichmentStatus.FAILED ? reason : null,
			},
		});

		this.logger.log({
			message: "Enrichment settled",
			companyId,
			status,
			reason,
		});
	}
}

/** The extracted object as prose, because a timeline entry is read, not parsed. */
function formatBrief(data: unknown): string {
	if (typeof data !== "object" || data === null) return String(data ?? "");

	const brief = data as {
		positioning?: unknown;
		pricingModel?: unknown;
		targetCustomer?: unknown;
		notableCustomers?: unknown;
		recentNews?: unknown;
	};

	const lines: string[] = [];
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const list = (value: unknown) =>
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];

	const positioning = text(brief.positioning);
	if (positioning) lines.push(positioning);

	const pricing = text(brief.pricingModel);
	if (pricing) lines.push(`Pricing: ${pricing}`);

	const target = text(brief.targetCustomer);
	if (target) lines.push(`Sells to: ${target}`);

	const customers = list(brief.notableCustomers);
	if (customers.length > 0) lines.push(`Customers: ${customers.join(", ")}`);

	const news = list(brief.recentNews);
	if (news.length > 0) {
		lines.push(`Recently:\n${news.map((item) => `• ${item}`).join("\n")}`);
	}

	return lines.join("\n\n");
}
