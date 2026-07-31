import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/** One hit in the quick switcher. */
export type SearchHit = {
	kind: "company" | "contact" | "deal";
	id: string;
	label: string;
	/** The line under the label — domain, company, whatever identifies it. */
	detail: string | null;
	iconUrl: string | null;
};

/** Per kind. Enough to be useful, few enough that the list stays scannable. */
const PER_KIND = 5;

@Injectable()
export class SearchService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * Everything matching one query string, across the three objects.
	 *
	 * Three indexed `contains` queries in parallel rather than a union view: the
	 * result has to be grouped by kind for the UI anyway, and this keeps each
	 * one's ordering and fields its own business.
	 */
	async quick(q: string): Promise<{ hits: SearchHit[] }> {
		const term = q.trim();
		if (term.length < 2) return { hits: [] };

		const [companies, contacts, deals] = await Promise.all([
			this.db.company.findMany({
				where: {
					OR: [
						{ name: { contains: term, mode: "insensitive" } },
						{ domain: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: { name: "asc" },
				select: { id: true, name: true, domain: true, iconUrl: true },
			}),
			this.db.contact.findMany({
				where: {
					OR: [
						{ firstName: { contains: term, mode: "insensitive" } },
						{ lastName: { contains: term, mode: "insensitive" } },
						{ email: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					company: { select: { name: true } },
				},
			}),
			this.db.deal.findMany({
				where: { name: { contains: term, mode: "insensitive" } },
				take: PER_KIND,
				orderBy: [{ stage: "asc" }, { name: "asc" }],
				select: {
					id: true,
					name: true,
					company: { select: { name: true, iconUrl: true } },
				},
			}),
		]);

		return {
			hits: [
				...companies.map(
					(company): SearchHit => ({
						kind: "company",
						id: company.id,
						label: company.name,
						detail: company.domain,
						iconUrl: company.iconUrl,
					}),
				),
				...contacts.map(
					(contact): SearchHit => ({
						kind: "contact",
						id: contact.id,
						label:
							[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
							(contact.email ?? "Unnamed"),
						detail: contact.company?.name ?? contact.email,
						iconUrl: null,
					}),
				),
				...deals.map(
					(deal): SearchHit => ({
						kind: "deal",
						id: deal.id,
						label: deal.name,
						detail: deal.company.name,
						iconUrl: deal.company.iconUrl,
					}),
				),
			],
		};
	}
}
