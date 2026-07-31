import { describe, expect, it } from "bun:test";
import { domainFromEmail, normalizeDomain } from "../src/companies/domain";
import {
	brandToUpdate,
	type CompanySnapshot,
} from "../src/enrichment/brand-mapping";
import type { Brand } from "../src/enrichment/context-dev.client";
import { EnrichmentQueue } from "../src/enrichment/enrichment.queue";

/** A company with nothing filled in — every gap open. */
function emptyCompany(
	overrides: Partial<CompanySnapshot> = {},
): CompanySnapshot {
	return {
		name: "Stripe",
		nameIsPlaceholder: false,
		description: null,
		logoUrl: null,
		logoDarkUrl: null,
		iconUrl: null,
		brandColor: null,
		industry: null,
		subIndustry: null,
		city: null,
		stateCode: null,
		country: null,
		countryCode: null,
		phone: null,
		email: null,
		linkedinUrl: null,
		twitterUrl: null,
		githubUrl: null,
		pricingUrl: null,
		careersUrl: null,
		...overrides,
	};
}

describe("normalizeDomain", () => {
	it("reduces anything a human might type to the bare host", () => {
		for (const input of [
			"stripe.com",
			"STRIPE.com",
			"  stripe.com  ",
			"www.stripe.com",
			"https://stripe.com",
			"https://www.Stripe.com/pricing?ref=x",
			"http://stripe.com/",
		]) {
			expect(normalizeDomain(input)).toBe("stripe.com");
		}
	});

	it("rejects things that are not hostnames", () => {
		for (const input of [
			"",
			"   ",
			"localhost",
			"my company",
			"not a domain",
		]) {
			expect(normalizeDomain(input)).toBeNull();
		}
		expect(normalizeDomain(null)).toBeNull();
		expect(normalizeDomain(undefined)).toBeNull();
	});
});

describe("domainFromEmail", () => {
	it("takes the domain off a work address", () => {
		expect(domainFromEmail("ada@stripe.com")).toBe("stripe.com");
		expect(domainFromEmail("  Ada@WWW.Stripe.com ")).toBe("stripe.com");
	});

	it("ignores free and malformed addresses", () => {
		// Creating a "Gmail" company from a personal address is the classic
		// CRM junk row.
		for (const email of [
			"ada@gmail.com",
			"ada@outlook.com",
			"ada@proton.me",
			"@stripe.com",
			"not-an-email",
			"",
		]) {
			expect(domainFromEmail(email)).toBeNull();
		}
	});
});

describe("brandToUpdate", () => {
	const brand: Brand = {
		title: "Stripe",
		description: "Payments infrastructure for the internet.",
		phone: "+1 888 963 8955",
		email: "support@stripe.com",
		colors: [{ hex: "#635bff", name: "Meteor Shower" }],
		logos: [
			{ url: "https://cdn/dark-logo.svg", mode: "dark", type: "logo" },
			{ url: "https://cdn/light-logo.svg", mode: "light", type: "logo" },
			{
				url: "https://cdn/icon.svg",
				mode: "has_opaque_background",
				type: "icon",
			},
		],
		socials: [
			{ type: "x", url: "https://x.com/stripe" },
			{ type: "linkedin", url: "https://linkedin.com/company/stripe" },
			{ type: "github", url: "https://github.com/stripe" },
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
		links: {
			pricing: "https://stripe.com/pricing",
			careers: "https://stripe.com/jobs",
		},
	};

	it("picks logos by mode and type rather than taking the first", () => {
		const update = brandToUpdate(brand, emptyCompany());

		expect(update.logoUrl).toBe("https://cdn/light-logo.svg");
		expect(update.logoDarkUrl).toBe("https://cdn/dark-logo.svg");
		expect(update.iconUrl).toBe("https://cdn/icon.svg");
	});

	it("maps the rest of the brand onto company fields", () => {
		const update = brandToUpdate(brand, emptyCompany());

		expect(update).toMatchObject({
			description: "Payments infrastructure for the internet.",
			brandColor: "#635bff",
			industry: "Finance",
			subIndustry: "Payments & Money Movement",
			city: "South San Francisco",
			stateCode: "CA",
			country: "United States",
			countryCode: "US",
			phone: "+1 888 963 8955",
			email: "support@stripe.com",
			linkedinUrl: "https://linkedin.com/company/stripe",
			twitterUrl: "https://x.com/stripe",
			githubUrl: "https://github.com/stripe",
			pricingUrl: "https://stripe.com/pricing",
			careersUrl: "https://stripe.com/jobs",
		});
	});

	it("never overwrites a value a human already set", () => {
		const update = brandToUpdate(
			brand,
			emptyCompany({
				description: "Our biggest account — handle with care.",
				city: "London",
				phone: "+44 20 7946 0000",
			}),
		);

		expect(update.description).toBeUndefined();
		expect(update.city).toBeUndefined();
		expect(update.phone).toBeUndefined();
		// The gaps are still filled.
		expect(update.country).toBe("United States");
	});

	it("leaves the name alone unless it is the domain placeholder", () => {
		expect(
			brandToUpdate(brand, emptyCompany({ name: "Stripe Inc" })).name,
		).toBeUndefined();

		expect(
			brandToUpdate(
				brand,
				emptyCompany({ name: "stripe.com", nameIsPlaceholder: true }),
			).name,
		).toBe("Stripe");
	});

	it("writes nothing when the lookup found nothing", () => {
		// Every field on a brand is nullable, so the all-null case is real.
		expect(brandToUpdate({}, emptyCompany())).toEqual({});
	});

	it("falls back to the slogan when there is no description", () => {
		const update = brandToUpdate(
			{ slogan: "Payments, simplified." },
			emptyCompany(),
		);
		expect(update.description).toBe("Payments, simplified.");
	});
});

/** The real queue, with the five-second backoff wound down. */
class FastQueue extends EnrichmentQueue {
	protected override get retryDelayMs(): number {
		return 5;
	}
}

describe("EnrichmentQueue", () => {
	it("runs at most two jobs at once", async () => {
		const queue = new EnrichmentQueue();
		let running = 0;
		let peak = 0;

		const job = async () => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 20));
			running -= 1;
		};

		for (let index = 0; index < 6; index++) {
			queue.enqueue(`job-${index}`, job);
		}
		await queue.drain();

		expect(peak).toBe(2);
	});

	it("refuses a key that is already queued", () => {
		const queue = new EnrichmentQueue();
		const job = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

		expect(queue.enqueue("company:1", job)).toBe(true);
		// A rep leaning on "Re-enrich" should not spend ten credits on one lookup.
		expect(queue.enqueue("company:1", job)).toBe(false);
		expect(queue.enqueue("company:2", job)).toBe(true);
	});

	it("retries a job that throws, once", async () => {
		const queue = new FastQueue();
		let attempts = 0;

		queue.enqueue("flaky", async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("cold cache timeout");
		});
		await queue.drain();

		expect(attempts).toBe(2);
	});

	it("gives up after the retry rather than looping", async () => {
		const queue = new FastQueue();
		let attempts = 0;

		queue.enqueue("broken", async () => {
			attempts += 1;
			throw new Error("still broken");
		});
		await queue.drain();

		expect(attempts).toBe(2);
	});

	it("drops queued work on shutdown instead of racing the database", async () => {
		const queue = new EnrichmentQueue();
		let ran = 0;
		const slow = async () => {
			ran += 1;
			await new Promise((resolve) => setTimeout(resolve, 30));
		};

		for (let index = 0; index < 5; index++) {
			queue.enqueue(`job-${index}`, slow);
		}
		queue.onApplicationShutdown();
		await queue.drain();

		// The two already in flight finish; the rest are dropped and stay PENDING.
		expect(ran).toBe(2);
		expect(queue.enqueue("after-shutdown", slow)).toBe(false);
	});
});
