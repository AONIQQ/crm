import { type Db, type Prisma, Prisma as PrismaNamespace } from "@crm/db";
import {
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { blankToNull, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { EnrichmentService } from "../enrichment/enrichment.service";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	ownerFilter,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import type {
	ContactCreateInput,
	ContactListInput,
	ContactUpdateInput,
} from "./contacts.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const COMPANY_SELECT = {
	id: true,
	name: true,
	domain: true,
	iconUrl: true,
	logoUrl: true,
} as const;

/** The facet value for a contact who works nowhere we know of. */
const NO_COMPANY = "none";

export type ContactRow = {
	id: string;
	firstName: string;
	lastName: string | null;
	email: string | null;
	title: string | null;
	company: {
		id: string;
		name: string;
		domain: string | null;
		iconUrl: string | null;
		logoUrl: string | null;
	} | null;
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	lastActivityAt: string | null;
};

/**
 * Orderings are arrays so every column can carry a tiebreak: without one,
 * everybody at the same company comes back in whatever order Postgres feels
 * like, and the order changes between pages of the same query.
 */
const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.ContactOrderByWithRelationInput[]
> = {
	// Surname first — a list of people sorted by first name is a list nobody can
	// scan.
	name: (dir) => [{ lastName: dir }, { firstName: dir }],
	email: (dir) => [{ email: dir }],
	title: (dir) => [{ title: dir }, { lastName: "asc" }],
	company: (dir) => [{ company: { name: dir } }, { lastName: "asc" }],
	createdAt: (dir) => [{ createdAt: dir }],
};

@Injectable()
export class ContactsService {
	private readonly logger = new Logger(ContactsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly enrichment: EnrichmentService,
	) {}

	async list(input: ContactListInput): Promise<ListResult<ContactRow>> {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts] = await Promise.all([
			this.db.contact.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [
					{ lastName: "asc" },
					{ firstName: "asc" },
				]),
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					title: true,
					company: { select: COMPANY_SELECT },
					owner: { select: OWNER_SELECT },
					activities: {
						take: 1,
						orderBy: { createdAt: "desc" },
						select: { createdAt: true },
					},
				},
			}),
			this.db.contact.count({ where }),
			this.facetCounts(input),
		]);

		return {
			rows: rows.map(({ activities, ...row }) => ({
				...row,
				lastActivityAt: activities[0]?.createdAt.toISOString() ?? null,
			})),
			total,
			facetCounts,
		};
	}

	async byId(id: string) {
		const contact = await this.db.contact.findUnique({
			where: { id },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				phone: true,
				title: true,
				linkedinUrl: true,
				createdAt: true,
				company: {
					select: { ...COMPANY_SELECT, industry: true, primaryContactId: true },
				},
				owner: { select: OWNER_SELECT },
				deals: {
					select: {
						role: true,
						deal: {
							select: {
								id: true,
								name: true,
								stage: true,
								amount: true,
								currency: true,
								expectedCloseDate: true,
								owner: { select: OWNER_SELECT },
							},
						},
					},
				},
			},
		});

		if (!contact) {
			throw new NotFoundException(`No contact with id ${id}.`);
		}

		const { deals, createdAt, company, ...rest } = contact;

		return {
			...rest,
			company,
			createdAt: createdAt.toISOString(),
			/** True when this is the person to call at their company. */
			isPrimaryContact: company?.primaryContactId === contact.id,
			deals: deals.map(({ role, deal }) => ({
				...deal,
				role,
				amount: undefined,
				amountCents: toCents(deal.amount),
				expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			})),
		};
	}

	async create(input: ContactCreateInput) {
		const email = blankToNull(input.email ?? "");

		if (email) {
			const existing = await this.db.contact.findUnique({
				where: { email },
				select: { id: true, firstName: true, lastName: true },
			});
			if (existing) {
				throw new ConflictException(
					`${[existing.firstName, existing.lastName].filter(Boolean).join(" ")} already uses ${email}.`,
				);
			}
		}

		// A work address tells us where someone works. Awaited rather than queued,
		// unlike company enrichment: the contact should arrive already attached to
		// the right company, not attach itself a few seconds later.
		const companyId =
			input.companyId ??
			(email ? await this.enrichment.companyForEmail(email) : null);

		const contact = await this.db.contact.create({
			data: {
				firstName: input.firstName.trim(),
				lastName: blankToNull(input.lastName ?? ""),
				email,
				phone: blankToNull(input.phone ?? ""),
				title: blankToNull(input.title ?? ""),
				companyId,
				ownerId: input.ownerId ?? null,
			},
			select: { id: true, firstName: true, lastName: true },
		});

		this.logger.log({ message: "Contact created", contactId: contact.id });

		return contact;
	}

	async update(id: string, input: ContactUpdateInput) {
		const data: Prisma.ContactUpdateInput = {};

		if (input.firstName !== undefined) data.firstName = input.firstName.trim();
		if (input.lastName !== undefined)
			data.lastName = blankToNull(input.lastName);
		if (input.email !== undefined) data.email = blankToNull(input.email);
		if (input.phone !== undefined) data.phone = blankToNull(input.phone);
		if (input.title !== undefined) data.title = blankToNull(input.title);
		if (input.linkedinUrl !== undefined) {
			data.linkedinUrl = blankToNull(input.linkedinUrl);
		}
		if (input.companyId !== undefined) {
			data.company = input.companyId
				? { connect: { id: input.companyId } }
				: { disconnect: true };
		}
		if (input.ownerId !== undefined) {
			data.owner = input.ownerId
				? { connect: { id: input.ownerId } }
				: { disconnect: true };
		}

		try {
			return await this.db.contact.update({
				where: { id },
				data,
				select: { id: true, firstName: true, lastName: true },
			});
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async remove(id: string): Promise<{ id: string }> {
		try {
			await this.db.contact.delete({ where: { id } });
		} catch (error) {
			throw this.translate(error, id);
		}
		this.logger.log({ message: "Contact deleted", contactId: id });
		return { id };
	}

	/** `q` matches a name, an email address, or where they work. */
	private searchFilter(q: string): Prisma.ContactWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ firstName: { contains: term, mode: "insensitive" } },
				{ lastName: { contains: term, mode: "insensitive" } },
				{ email: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(input: ContactListInput): Prisma.ContactWhereInput {
		const where: Prisma.ContactWhereInput = {
			...this.searchFilter(input.q),
			...ownerFilter(input.owner),
		};

		if (input.company !== FACET_ALL) {
			where.companyId = input.company === NO_COMPANY ? null : input.company;
		}

		return where;
	}

	/** Counts against the search term only — see `CompaniesService.facetCounts`. */
	private async facetCounts(input: ContactListInput) {
		const where = this.searchFilter(input.q);

		const [owners, companies] = await Promise.all([
			this.db.contact.groupBy({
				by: ["ownerId"],
				where,
				_count: { _all: true },
			}),
			this.db.contact.groupBy({
				by: ["companyId"],
				where,
				_count: { _all: true },
			}),
		]);

		return {
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			company: countsByKey(companies, "companyId", NO_COMPANY),
		};
	}

	private translate(error: unknown, id: string): unknown {
		if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
			if (error.code === "P2025") {
				return new NotFoundException(`No contact with id ${id}.`);
			}
			if (error.code === "P2002") {
				return new ConflictException(
					"Another contact already uses that email address.",
				);
			}
		}
		return error;
	}
}
