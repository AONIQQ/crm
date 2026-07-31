import { type Db, type DealStage, DealStage as Stage } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";
import { blankToNull, fromCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { isClosedStage } from "../deals/deal-stage";
import { EnrichmentService } from "../enrichment/enrichment.service";
import {
	type CsvRow,
	field,
	type ParsedRow,
	parseAmountCents,
	parseCsv,
	parseCsvDate,
} from "./csv";
import type {
	ImportInput,
	ImportKind,
	ImportReport,
	ImportRowReport,
} from "./import.contracts";

/**
 * HubSpot's deal stage names, lower-cased, mapped onto ours.
 *
 * Anything unrecognised lands in `DEMO_BOOKED` rather than failing the row: a
 * deal in the wrong column is a two-second fix, a deal that did not import is
 * a deal nobody knows is missing.
 */
const STAGE_ALIASES: Record<string, DealStage> = {
	"demo booked": Stage.DEMO_BOOKED,
	appointmentscheduled: Stage.DEMO_BOOKED,
	"appointment scheduled": Stage.DEMO_BOOKED,
	"qualified to buy": Stage.QUALIFIED_TO_BUY,
	qualifiedtobuy: Stage.QUALIFIED_TO_BUY,
	"unqualified to buy": Stage.UNQUALIFIED_TO_BUY,
	unqualified: Stage.UNQUALIFIED_TO_BUY,
	"decision maker bought in": Stage.DECISION_MAKER_BOUGHT_IN,
	decisionmakerboughtin: Stage.DECISION_MAKER_BOUGHT_IN,
	"contract sent": Stage.CONTRACT_SENT,
	contractsent: Stage.CONTRACT_SENT,
	"closed won": Stage.CLOSED_WON,
	closedwon: Stage.CLOSED_WON,
	"closed lost": Stage.CLOSED_LOST,
	closedlost: Stage.CLOSED_LOST,
};

/** Rows above this are refused rather than quietly truncated. */
const MAX_ROWS = 5_000;

@Injectable()
export class ImportService {
	private readonly logger = new Logger(ImportService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly enrichment: EnrichmentService,
	) {}

	async run(input: ImportInput): Promise<ImportReport> {
		const rows = parseCsv(input.csv);

		if (rows.length > MAX_ROWS) {
			throw new Error(
				`That file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it and import in batches.`,
			);
		}

		const reports =
			input.kind === "companies"
				? await this.importCompanies(rows, input)
				: input.kind === "contacts"
					? await this.importContacts(rows, input)
					: await this.importDeals(rows, input);

		const report = summarise(input.kind, input.dryRun, reports);

		this.logger.log({
			message: input.dryRun ? "Import dry run" : "Import applied",
			kind: input.kind,
			total: report.total,
			created: report.created,
			updated: report.updated,
			skipped: report.skipped,
			failed: report.failed,
		});

		return report;
	}

	private async importCompanies(
		rows: ParsedRow[],
		input: ImportInput,
	): Promise<ImportRowReport[]> {
		// Warm Context.dev's cache for the whole file before touching any of it.
		// Prefetch is free, and it turns a queue of cold 7-second lookups into
		// warm sub-second ones once the rows land.
		if (!input.dryRun) {
			await this.enrichment.warm(
				rows
					.map(({ values }) =>
						normalizeDomain(
							field(values, "domain", "Company Domain Name", "website"),
						),
					)
					.filter((domain): domain is string => domain !== null),
			);
		}

		const reports: ImportRowReport[] = [];

		for (const { line, values: row } of rows) {
			const name = field(row, "name", "Company name");
			const domain = normalizeDomain(
				field(row, "domain", "Company Domain Name", "website"),
			);

			if (!name && !domain) {
				reports.push({
					line,
					outcome: "skipped",
					key: null,
					label: null,
					reason: "No name and no domain.",
				});
				continue;
			}

			// Domain is the dedupe key. Rows without one fall back to an exact,
			// case-insensitive name match — HubSpot company exports often have no
			// domain column, and without a fallback every re-import would duplicate
			// those rows. The match is exact on purpose: fuzzy company names merge
			// accounts that are not the same company.
			const existing = domain
				? await this.db.company.findUnique({
						where: { domain },
						select: { id: true, name: true },
					})
				: name
					? await this.db.company.findFirst({
							where: {
								name: { equals: name, mode: "insensitive" },
								domain: null,
							},
							select: { id: true, name: true },
						})
					: null;

			// Worth saying out loud: a name match is a weaker claim than a domain
			// match, and the reader of the report is the one who can judge it.
			const matchedByName = existing !== null && domain === null;
			const label = name ?? domain;

			if (input.dryRun) {
				reports.push({
					line,
					outcome: existing ? "updated" : "created",
					key: domain,
					label,
					reason: matchedByName
						? "Matched on name — this row has no domain."
						: domain
							? undefined
							: "No domain, so this company cannot be matched on re-import.",
				});
				continue;
			}

			try {
				if (existing) {
					// Only fills gaps, exactly like the agent: an import should not
					// undo edits someone made after the last one.
					await this.db.company.update({
						where: { id: existing.id },
						data: {
							phone:
								blankToNull(field(row, "phone", "Phone Number") ?? "") ??
								undefined,
							city: blankToNull(field(row, "city") ?? "") ?? undefined,
							country: blankToNull(field(row, "country") ?? "") ?? undefined,
							industry: blankToNull(field(row, "industry") ?? "") ?? undefined,
						},
					});
					reports.push({
						line,
						outcome: "updated",
						key: domain,
						label,
						reason: matchedByName
							? "Matched on name — this row has no domain."
							: undefined,
					});
					continue;
				}

				const company = await this.db.company.create({
					data: {
						name: name ?? domain ?? "Unnamed",
						domain,
						website: domain ? `https://${domain}` : null,
						phone: blankToNull(field(row, "phone", "Phone Number") ?? ""),
						city: blankToNull(field(row, "city") ?? ""),
						country: blankToNull(field(row, "country") ?? ""),
						industry: blankToNull(field(row, "industry") ?? ""),
						ownerId: input.defaultOwnerId ?? null,
					},
					select: { id: true },
				});

				this.enrichment.enqueueCompany(company.id);
				reports.push({ line, outcome: "created", key: domain, label });
			} catch (error) {
				reports.push({
					line,
					outcome: "failed",
					key: domain,
					label,
					reason: describe(error),
				});
			}
		}

		return reports;
	}

	private async importContacts(
		rows: ParsedRow[],
		input: ImportInput,
	): Promise<ImportRowReport[]> {
		const reports: ImportRowReport[] = [];

		for (const { line, values: row } of rows) {
			const email = blankToNull(
				(field(row, "email", "Email Address") ?? "").toLowerCase(),
			);
			const firstName = field(row, "firstname", "First Name");
			const lastName = field(row, "lastname", "Last Name");
			const label = [firstName, lastName].filter(Boolean).join(" ") || email;

			if (!firstName && !email) {
				reports.push({
					line,
					outcome: "skipped",
					key: null,
					label: null,
					reason: "No name and no email.",
				});
				continue;
			}

			// Dedupe on email, which is unique — this is what makes re-running an
			// import safe.
			const existing = email
				? await this.db.contact.findUnique({
						where: { email },
						select: { id: true },
					})
				: null;

			if (input.dryRun) {
				reports.push({
					line,
					outcome: existing ? "updated" : "created",
					key: email,
					label,
				});
				continue;
			}

			try {
				const companyId = await this.resolveCompany(row, email);

				if (existing) {
					await this.db.contact.update({
						where: { id: existing.id },
						data: {
							phone:
								blankToNull(field(row, "phone", "Phone Number") ?? "") ??
								undefined,
							title:
								blankToNull(
									field(row, "jobtitle", "Job Title", "title") ?? "",
								) ?? undefined,
							...(companyId ? { companyId } : {}),
						},
					});
					reports.push({ line, outcome: "updated", key: email, label });
					continue;
				}

				await this.db.contact.create({
					data: {
						firstName: firstName ?? email ?? "Unnamed",
						lastName: blankToNull(lastName ?? ""),
						email,
						phone: blankToNull(field(row, "phone", "Phone Number") ?? ""),
						title: blankToNull(
							field(row, "jobtitle", "Job Title", "title") ?? "",
						),
						companyId,
						ownerId: input.defaultOwnerId ?? null,
					},
				});

				reports.push({ line, outcome: "created", key: email, label });
			} catch (error) {
				reports.push({
					line,
					outcome: "failed",
					key: email,
					label,
					reason: describe(error),
				});
			}
		}

		return reports;
	}

	private async importDeals(
		rows: ParsedRow[],
		input: ImportInput,
	): Promise<ImportRowReport[]> {
		const reports: ImportRowReport[] = [];

		// Deals need an owner — the column is required in our schema — so a file
		// with no owner and no default cannot be applied at all.
		const fallbackOwnerId =
			input.defaultOwnerId ??
			(await this.db.user.findFirst({ select: { id: true } }))?.id ??
			null;

		for (const { line, values: row } of rows) {
			const name = field(row, "dealname", "Deal Name", "name");
			const companyName = field(row, "company", "Associated Company");
			const domain = normalizeDomain(
				field(row, "domain", "Associated Company Domain", "website"),
			);
			const label = name ?? null;

			if (!name) {
				reports.push({
					line,
					outcome: "skipped",
					key: null,
					label: null,
					reason: "No deal name.",
				});
				continue;
			}

			const company = await this.findCompany(domain, companyName);

			if (!company) {
				reports.push({
					line,
					outcome: "skipped",
					key: domain ?? companyName ?? null,
					label,
					reason:
						"No matching company — import companies first, or add the domain column.",
				});
				continue;
			}

			if (!fallbackOwnerId) {
				reports.push({
					line,
					outcome: "skipped",
					key: name,
					label,
					reason: "Every deal needs an owner; pick a default.",
				});
				continue;
			}

			// Deals have no natural key, so "the same name at the same company" is
			// the closest thing to one. It is what makes a re-run update rather
			// than duplicate.
			const existing = await this.db.deal.findFirst({
				where: { name, companyId: company.id },
				select: { id: true },
			});

			if (input.dryRun) {
				reports.push({
					line,
					outcome: existing ? "updated" : "created",
					key: company.id,
					label,
				});
				continue;
			}

			try {
				const stage = resolveStage(
					field(row, "dealstage", "Deal Stage", "stage"),
				);
				const amountCents = parseAmountCents(field(row, "amount"));
				const closeDate = parseCsvDate(field(row, "closedate", "Close Date"));
				const closed = isClosedStage(stage);

				const data = {
					name,
					companyId: company.id,
					ownerId: fallbackOwnerId,
					stage,
					amount: fromCents(amountCents),
					expectedCloseDate: closeDate,
					closedAt: closed ? (closeDate ?? new Date()) : null,
				};

				if (existing) {
					await this.db.deal.update({ where: { id: existing.id }, data });
					reports.push({ line, outcome: "updated", key: company.id, label });
				} else {
					await this.db.deal.create({ data });
					reports.push({ line, outcome: "created", key: company.id, label });
				}
			} catch (error) {
				reports.push({
					line,
					outcome: "failed",
					key: company.id,
					label,
					reason: describe(error),
				});
			}
		}

		return reports;
	}

	/** The company a contact row belongs to: an explicit column, then the email. */
	private async resolveCompany(
		row: CsvRow,
		email: string | null,
	): Promise<string | null> {
		const domain = normalizeDomain(
			field(row, "domain", "Associated Company Domain", "Company Domain Name"),
		);
		const companyName = field(row, "company", "Associated Company");

		const matched = await this.findCompany(domain, companyName);
		if (matched) return matched.id;

		// Falls back to the agent, which will find or create one from the work
		// address — the same path a hand-added contact takes.
		return email ? this.enrichment.companyForEmail(email) : null;
	}

	private async findCompany(domain: string | null, name: string | undefined) {
		if (domain) {
			const byDomain = await this.db.company.findUnique({
				where: { domain },
				select: { id: true },
			});
			if (byDomain) return byDomain;
		}

		if (name) {
			// Name matching is a fallback, and deliberately exact — fuzzy matching
			// on company names attaches deals to the wrong account.
			return this.db.company.findFirst({
				where: { name: { equals: name, mode: "insensitive" } },
				select: { id: true },
			});
		}

		return null;
	}
}

function resolveStage(value: string | undefined): DealStage {
	if (!value) return Stage.DEMO_BOOKED;
	const key = value.trim().toLowerCase();
	return (
		STAGE_ALIASES[key] ??
		STAGE_ALIASES[key.replace(/[^a-z]/g, "")] ??
		Stage.DEMO_BOOKED
	);
}

function summarise(
	kind: ImportKind,
	dryRun: boolean,
	rows: ImportRowReport[],
): ImportReport {
	const count = (outcome: ImportRowReport["outcome"]) =>
		rows.filter((row) => row.outcome === outcome).length;

	return {
		kind,
		dryRun,
		total: rows.length,
		created: count("created"),
		updated: count("updated"),
		skipped: count("skipped"),
		failed: count("failed"),
		rows,
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
