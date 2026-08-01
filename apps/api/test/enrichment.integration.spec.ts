import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * The enrichment pipeline end to end, against a stub Context.dev.
 *
 * The SDK reads `CONTEXT_DEV_BASE_URL` from the environment, so pointing it at
 * a local server needs no production code — everything below is the real
 * client, the real queue, the real mapping and the real database. What it does
 * *not* prove is that Context.dev's live payloads match the documented schema;
 * only a real key does that.
 *
 * Set before importing anything that constructs the client.
 */
const stubResponses: Record<string, () => Response> = {};
const requests: { path: string; body: unknown }[] = [];

const server = Bun.serve({
	port: 0,
	fetch: async (request) => {
		const path = new URL(request.url).pathname;
		const body = await request.json().catch(() => null);
		requests.push({ path, body });

		const key = routeKey(path, body);
		const handler = stubResponses[key] ?? stubResponses[path];

		return (
			handler?.() ?? Response.json({ error_code: "NOT_FOUND" }, { status: 400 })
		);
	},
});

/** Brand lookups all share one path, so the discriminator picks the case. */
function routeKey(path: string, body: unknown): string {
	const identifier =
		body && typeof body === "object"
			? ((body as Record<string, unknown>).domain ??
				(body as Record<string, unknown>).email)
			: undefined;
	return typeof identifier === "string" ? `${path}:${identifier}` : path;
}

process.env.CONTEXT_DEV_API_KEY = "ctxt_test_key";
process.env.CONTEXT_DEV_BASE_URL = `http://localhost:${server.port}/v1`;
process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@localhost:5432/crm?schema=public";

const { db } = await import("@crm/db");
const { ContextDevClient } = await import(
	"../src/enrichment/context-dev.client"
);
const { EnrichmentQueue } = await import("../src/enrichment/enrichment.queue");
const { ActivityStampService } = await import(
	"../src/crm/activity-stamp.service"
);
const { EnrichmentService } = await import(
	"../src/enrichment/enrichment.service"
);

/** The real queue, with the five-second backoff wound down. */
class FastQueue extends EnrichmentQueue {
	protected override get retryDelayMs(): number {
		return 5;
	}
}

/** `ConfigService`, as much of it as the client uses. */
const config = {
	get: (key: string) => process.env[key],
} as never;

const STRIPE_BRAND = {
	status: "ok",
	code: 200,
	brand: {
		domain: "enrich-test.example",
		title: "Enrich Test",
		description: "Payments infrastructure for the internet.",
		slogan: "Ignored — description wins.",
		email: "hello@enrich-test.example",
		phone: "+1 888 555 0100",
		colors: [{ hex: "#635bff", name: "Meteor Shower" }],
		logos: [
			{ url: "https://cdn/dark.svg", mode: "dark", type: "logo" },
			{ url: "https://cdn/light.svg", mode: "light", type: "logo" },
			{ url: "https://cdn/icon.svg", mode: "light", type: "icon" },
		],
		socials: [
			{ type: "linkedin", url: "https://linkedin.com/company/enrich-test" },
			{ type: "x", url: "https://x.com/enrichtest" },
		],
		address: {
			city: "South San Francisco",
			state_code: "CA",
			country: "United States",
			country_code: "US",
		},
		industries: {
			eic: [{ industry: "Finance", subindustry: "Payments & Money Movement" }],
		},
		links: { pricing: "https://enrich-test.example/pricing" },
	},
};

const TEST_DOMAINS = [
	"enrich-test.example",
	"enrich-missing.example",
	"enrich-broken.example",
	"enrich-email.example",
	"enrich-research.example",
];

let service: InstanceType<typeof EnrichmentService>;
let userId: string;

beforeAll(async () => {
	const client = new ContextDevClient(config);
	service = new EnrichmentService(
		db,
		client,
		new FastQueue(),
		new ActivityStampService(db),
	);

	const user = await db.user.upsert({
		where: { email: "enrichment-test@localhost" },
		create: {
			id: "enrichment-test-user",
			email: "enrichment-test@localhost",
			name: "Enrichment Test",
			emailVerified: true,
			updatedAt: new Date(),
		},
		update: {},
		select: { id: true },
	});
	userId = user.id;

	stubResponses["/v1/utility/prefetch"] = () => Response.json({ status: "ok" });
	stubResponses["/v1/brand/retrieve:enrich-test.example"] = () =>
		Response.json(STRIPE_BRAND);
	stubResponses["/v1/brand/retrieve:enrich-missing.example"] = () =>
		Response.json({ error_code: "NOT_FOUND" }, { status: 400 });
	stubResponses["/v1/brand/retrieve:enrich-broken.example"] = () =>
		Response.json({ error_code: "RATE_LIMITED" }, { status: 429 });
	stubResponses["/v1/brand/retrieve:ada@enrich-email.example"] = () =>
		Response.json({
			status: "ok",
			code: 200,
			brand: { domain: "enrich-email.example", title: "Enrich Email Co" },
		});
	stubResponses["/v1/brand/retrieve:ada@gmail.com"] = () =>
		Response.json({ error_code: "FREE_EMAIL_DETECTED" }, { status: 422 });
	stubResponses["/v1/web/extract"] = () =>
		Response.json({
			data: {
				positioning: "Sells payments infrastructure to developers.",
				pricingModel: "Usage-based, per transaction.",
				notableCustomers: ["Amazon", "Shopify"],
				recentNews: ["Raised a Series H."],
			},
			urls_analyzed: ["https://enrich-research.example"],
		});
});

afterAll(async () => {
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.company.deleteMany({ where: { domain: { in: TEST_DOMAINS } } });
	await db.user.deleteMany({ where: { id: userId } });
	await db.$disconnect();
	server.stop(true);
});

async function makeCompany(
	domain: string | null,
	overrides: Record<string, unknown> = {},
) {
	return db.company.create({
		data: {
			name: (overrides.name as string | undefined) ?? "Placeholder",
			domain,
			...overrides,
		},
		select: { id: true },
	});
}

describe("enrichment against a stub Context.dev", () => {
	it("fills a company in and keeps the raw payload", async () => {
		const { id } = await makeCompany("enrich-test.example", {
			name: "enrich-test.example",
			// A value a human typed. The agent must not touch it.
			city: "London",
		});

		expect(service.enqueueCompany(id)).toBe(true);
		await service.drain();

		const company = await db.company.findUniqueOrThrow({
			where: { id },
			select: {
				name: true,
				description: true,
				logoUrl: true,
				logoDarkUrl: true,
				iconUrl: true,
				brandColor: true,
				industry: true,
				subIndustry: true,
				city: true,
				country: true,
				phone: true,
				linkedinUrl: true,
				twitterUrl: true,
				pricingUrl: true,
				enrichmentStatus: true,
				enrichedAt: true,
				enrichmentError: true,
				enrichment: { select: { raw: true, source: true } },
			},
		});

		expect(company.enrichmentStatus).toBe("COMPLETE");
		expect(company.enrichmentError).toBeNull();
		expect(company.enrichedAt).not.toBeNull();

		// The name was the domain, so the lookup is allowed to replace it.
		expect(company.name).toBe("Enrich Test");
		expect(company.description).toBe(
			"Payments infrastructure for the internet.",
		);
		// Logos by mode and type, not logos[0].
		expect(company.logoUrl).toBe("https://cdn/light.svg");
		expect(company.logoDarkUrl).toBe("https://cdn/dark.svg");
		expect(company.iconUrl).toBe("https://cdn/icon.svg");
		expect(company.brandColor).toBe("#635bff");
		expect(company.industry).toBe("Finance");
		expect(company.subIndustry).toBe("Payments & Money Movement");
		expect(company.country).toBe("United States");
		expect(company.phone).toBe("+1 888 555 0100");
		expect(company.linkedinUrl).toBe(
			"https://linkedin.com/company/enrich-test",
		);
		expect(company.twitterUrl).toBe("https://x.com/enrichtest");
		expect(company.pricingUrl).toBe("https://enrich-test.example/pricing");

		// The one field a human had already set.
		expect(company.city).toBe("London");

		// The whole payload is kept so re-deriving a field costs no credits.
		expect(company.enrichment?.source).toBe("context.dev");
		expect(
			(company.enrichment?.raw as { brand?: { title?: string } })?.brand?.title,
		).toBe("Enrich Test");
	});

	it("warms the cache before looking a domain up", () => {
		// Prefetch is free and turns a cold 7s lookup into a warm one.
		const paths = requests.map((request) => request.path);
		expect(paths).toContain("/v1/utility/prefetch");
		expect(paths.indexOf("/v1/utility/prefetch")).toBeLessThan(
			paths.indexOf("/v1/brand/retrieve"),
		);
	});

	it("records an unknown domain as SKIPPED, not FAILED", async () => {
		const { id } = await makeCompany("enrich-missing.example");

		service.enqueueCompany(id);
		await service.drain();

		const company = await db.company.findUniqueOrThrow({
			where: { id },
			select: { enrichmentStatus: true, enrichmentError: true },
		});

		// Nothing to find is a settled answer, and it is not billed — so it is
		// not an error message to put in front of a rep.
		expect(company.enrichmentStatus).toBe("SKIPPED");
		expect(company.enrichmentError).toBeNull();
	});

	it("records a rate limit as FAILED, with the reason", async () => {
		const { id } = await makeCompany("enrich-broken.example");

		service.enqueueCompany(id);
		await service.drain();

		const company = await db.company.findUniqueOrThrow({
			where: { id },
			select: { enrichmentStatus: true, enrichmentError: true },
		});

		expect(company.enrichmentStatus).toBe("FAILED");
		expect(company.enrichmentError).toContain("429");
	});

	it("skips a company with no domain without calling out at all", async () => {
		const { id } = await makeCompany(null, { name: "No Domain Co" });
		const before = requests.length;

		service.enqueueCompany(id);
		await service.drain();

		const company = await db.company.findUniqueOrThrow({
			where: { id },
			select: { enrichmentStatus: true },
		});

		expect(company.enrichmentStatus).toBe("SKIPPED");
		expect(requests.length).toBe(before);

		await db.company.delete({ where: { id } });
	});

	it("refuses to queue the same company twice", async () => {
		const { id } = await makeCompany("enrich-test.example-dupe" as string);

		expect(service.enqueueCompany(id)).toBe(true);
		// A rep leaning on Re-enrich should not spend ten credits on one lookup.
		expect(service.enqueueCompany(id)).toBe(false);

		await service.drain();
		await db.company.delete({ where: { id } });
	});

	describe("companyForEmail", () => {
		it("creates the company behind a work address", async () => {
			const companyId = await service.companyForEmail(
				"ada@enrich-email.example",
			);
			expect(companyId).not.toBeNull();

			const company = await db.company.findUniqueOrThrow({
				where: { domain: "enrich-email.example" },
				select: { name: true, website: true },
			});
			expect(company.name).toBe("Enrich Email Co");
			expect(company.website).toBe("https://enrich-email.example");

			await service.drain();
		});

		it("returns the company we already have rather than looking again", async () => {
			const before = requests.length;
			const companyId = await service.companyForEmail(
				"someone-else@enrich-email.example",
			);

			expect(companyId).not.toBeNull();
			// Already known: no second lookup, no second ten credits.
			expect(requests.length).toBe(before);
		});

		it("ignores a personal address", async () => {
			expect(await service.companyForEmail("ada@gmail.com")).toBeNull();
			// Rejected on the free-domain list before any call is made.
			expect(
				requests.some((request) =>
					JSON.stringify(request.body).includes("gmail.com"),
				),
			).toBe(false);
		});
	});

	it("posts a research brief to the company timeline", async () => {
		const { id } = await makeCompany("enrich-research.example", {
			name: "Research Co",
			website: "https://enrich-research.example",
		});

		const result = await service.researchCompany(id, userId);
		expect(result.ok).toBe(true);

		const activity = await db.activity.findFirstOrThrow({
			where: { companyId: id, type: "ENRICHMENT" },
			select: { subject: true, body: true, meta: true, occurredAt: true },
		});

		expect(activity.subject).toBe("Research brief — Research Co");
		// Rendered as prose, because a timeline entry is read rather than parsed.
		expect(activity.body).toContain(
			"Sells payments infrastructure to developers.",
		);
		expect(activity.body).toContain("Pricing: Usage-based, per transaction.");
		expect(activity.body).toContain("Customers: Amazon, Shopify");
		expect(activity.body).toContain("• Raised a Series H.");
		expect(activity.occurredAt).not.toBeNull();
		expect((activity.meta as { creditCost?: number })?.creditCost).toBe(10);
	});

	it("reports a company with no website rather than guessing a URL", async () => {
		const { id } = await makeCompany(null, { name: "Websiteless" });

		const result = await service.researchCompany(id, userId);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain("no website");

		await db.company.delete({ where: { id } });
	});
});
