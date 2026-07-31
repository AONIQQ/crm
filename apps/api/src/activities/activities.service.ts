import {
	ActivityType,
	type Db,
	type Prisma,
	Prisma as PrismaNamespace,
} from "@crm/db";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { blankToNull } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import type {
	ActivityCreateInput,
	ActivityUpdateInput,
	MyTasksInput,
	TimelineFilter,
	TimelineInput,
} from "./activities.contracts";

const AUTHOR_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const ENTRY_SELECT = {
	id: true,
	type: true,
	subject: true,
	body: true,
	occurredAt: true,
	dueAt: true,
	completedAt: true,
	meta: true,
	createdAt: true,
	createdBy: { select: AUTHOR_SELECT },
	company: { select: { id: true, name: true } },
	contact: { select: { id: true, firstName: true, lastName: true } },
	deal: { select: { id: true, name: true } },
} as const;

/** Entries a `NOTE`-ish filter should keep — what someone wrote down. */
const NOTE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
];

@Injectable()
export class ActivitiesService {
	private readonly logger = new Logger(ActivitiesService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * A record's timeline, newest first, paged by cursor.
	 *
	 * Cursor rather than offset because entries are added at the top while
	 * someone is reading: page two of an offset query would repeat whatever the
	 * new entry pushed down.
	 */
	async timeline(input: TimelineInput) {
		const where = this.anchor(input);
		Object.assign(where, filterClause(input.filter));

		const rows = await this.db.activity.findMany({
			where,
			// One more than asked for, so we know whether there is another page
			// without a second count query.
			take: input.limit + 1,
			...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: ENTRY_SELECT,
		});

		const hasMore = rows.length > input.limit;
		const entries = hasMore ? rows.slice(0, input.limit) : rows;

		return {
			entries: entries.map(serializeEntry),
			nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
		};
	}

	/**
	 * Counts for the timeline's filter tabs, over the same anchor.
	 *
	 * Separate from `timeline` so paging does not re-count on every scroll.
	 */
	async timelineCounts(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	) {
		const anchor = this.anchor(input);

		const [all, notes, upcoming, done] = await Promise.all([
			this.db.activity.count({ where: anchor }),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("notes") },
			}),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("upcoming") },
			}),
			this.db.activity.count({ where: { ...anchor, ...filterClause("done") } }),
		]);

		return { all, notes, upcoming, done };
	}

	async create(input: ActivityCreateInput, actingUserId: string) {
		// A deal or contact activity is stamped with its company too, so a company
		// timeline is one indexed range scan instead of three joins.
		const companyId = await this.resolveCompanyId(input);

		const isTask = input.type === ActivityType.TASK;

		const activity = await this.db.activity.create({
			data: {
				type: input.type,
				subject: blankToNull(input.subject ?? ""),
				body: blankToNull(input.body ?? ""),
				// A task is scheduled, not logged; everything else already happened
				// unless the composer says otherwise.
				occurredAt: isTask ? null : (parseDate(input.occurredAt) ?? new Date()),
				dueAt: isTask ? parseDate(input.dueAt) : null,
				companyId,
				contactId: input.contactId ?? null,
				dealId: input.dealId ?? null,
				createdById: actingUserId,
			},
			select: ENTRY_SELECT,
		});

		this.logger.log({
			message: "Activity logged",
			activityId: activity.id,
			type: activity.type,
		});

		return serializeEntry(activity);
	}

	async update(input: ActivityUpdateInput) {
		const data: Prisma.ActivityUpdateInput = {};

		if (input.subject !== undefined) data.subject = blankToNull(input.subject);
		if (input.body !== undefined) data.body = blankToNull(input.body);
		if (input.dueAt !== undefined) data.dueAt = parseDate(input.dueAt);
		if (input.occurredAt !== undefined) {
			data.occurredAt = parseDate(input.occurredAt);
		}

		try {
			const activity = await this.db.activity.update({
				where: { id: input.id },
				data,
				select: ENTRY_SELECT,
			});
			return serializeEntry(activity);
		} catch (error) {
			throw this.translate(error, input.id);
		}
	}

	/** Ticks a task off, or puts it back. */
	async complete(id: string, completed: boolean) {
		const activity = await this.db.activity.findUnique({
			where: { id },
			select: { type: true },
		});

		if (!activity) {
			throw new NotFoundException(`No activity with id ${id}.`);
		}

		if (activity.type !== ActivityType.TASK) {
			throw new BadRequestException("Only tasks can be completed.");
		}

		const updated = await this.db.activity.update({
			where: { id },
			data: { completedAt: completed ? new Date() : null },
			select: ENTRY_SELECT,
		});

		return serializeEntry(updated);
	}

	async remove(id: string): Promise<{ id: string }> {
		try {
			await this.db.activity.delete({ where: { id } });
		} catch (error) {
			throw this.translate(error, id);
		}
		return { id };
	}

	/** Open tasks assigned to whoever is asking. */
	async myTasks(input: MyTasksInput, actingUserId: string) {
		const now = new Date();
		const where: Prisma.ActivityWhereInput = {
			type: ActivityType.TASK,
			completedAt: null,
			createdById: actingUserId,
		};

		if (input.window === "overdue") where.dueAt = { lt: now };
		if (input.window === "upcoming") where.dueAt = { gte: now };

		const tasks = await this.db.activity.findMany({
			where,
			take: input.limit,
			// Undated tasks last: a task with no due date is a someday, and it
			// should not sit above something due this afternoon.
			orderBy: [
				{ dueAt: { sort: "asc", nulls: "last" } },
				{ createdAt: "desc" },
			],
			select: ENTRY_SELECT,
		});

		return tasks.map(serializeEntry);
	}

	/** Exactly one of company/contact/deal, as the contract promises. */
	private anchor(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	): Prisma.ActivityWhereInput {
		if (input.dealId) return { dealId: input.dealId };
		if (input.contactId) return { contactId: input.contactId };
		if (input.companyId) return { companyId: input.companyId };
		throw new BadRequestException(
			"A timeline needs a company, a contact or a deal.",
		);
	}

	/**
	 * The company an activity belongs to.
	 *
	 * Taken from the deal or contact when the caller did not say, which is what
	 * makes the company timeline work without joins. A contact with no company
	 * simply has no company stamp.
	 */
	private async resolveCompanyId(
		input: ActivityCreateInput,
	): Promise<string | null> {
		if (input.companyId) return input.companyId;

		if (input.dealId) {
			const deal = await this.db.deal.findUnique({
				where: { id: input.dealId },
				select: { companyId: true },
			});
			if (!deal) {
				throw new NotFoundException(`No deal with id ${input.dealId}.`);
			}
			return deal.companyId;
		}

		if (input.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: input.contactId },
				select: { companyId: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${input.contactId}.`);
			}
			return contact.companyId;
		}

		return null;
	}

	private translate(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No activity with id ${id}.`);
		}
		return error;
	}
}

function filterClause(filter: TimelineFilter): Prisma.ActivityWhereInput {
	switch (filter) {
		case "notes":
			return { type: { in: NOTE_TYPES } };
		case "upcoming":
			// Everything still outstanding, overdue included — "upcoming" on a
			// timeline means "not done yet", and hiding the overdue ones is how
			// they get forgotten.
			return { type: ActivityType.TASK, completedAt: null };
		case "done":
			return { type: ActivityType.TASK, completedAt: { not: null } };
		case "history":
			return { NOT: { type: ActivityType.TASK, completedAt: null } };
		case "all":
			return {};
	}
}

type Entry = Prisma.ActivityGetPayload<{ select: typeof ENTRY_SELECT }>;

/** Dates as ISO strings so they survive JSON, and `meta` narrowed for the UI. */
function serializeEntry(entry: Entry) {
	return {
		...entry,
		occurredAt: entry.occurredAt?.toISOString() ?? null,
		dueAt: entry.dueAt?.toISOString() ?? null,
		completedAt: entry.completedAt?.toISOString() ?? null,
		createdAt: entry.createdAt.toISOString(),
		meta: entry.meta as Record<string, unknown> | null,
	};
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
