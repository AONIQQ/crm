import { z } from "zod";

/**
 * The shape every list procedure speaks, so one `DataTable` on the front end can
 * drive companies, contacts and deals without per-module plumbing.
 *
 * Filtering, sorting and pagination all happen in Prisma — the browser never
 * receives more rows than it draws.
 */
export const listInput = z.object({
	q: z.string().default(""),
	sort: z.string().default(""),
	dir: z.enum(["asc", "desc"]).default("asc"),
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(100).default(25),
});

export type ListInput = z.infer<typeof listInput>;

/** Facet id → value → number of rows that would match. */
export type FacetCounts = Record<string, Record<string, number>>;

export type ListResult<TRow> = {
	rows: TRow[];
	total: number;
	facetCounts: FacetCounts;
};

/** `skip`/`take` for a 1-based page number. */
export function paginate(input: Pick<ListInput, "page" | "pageSize">): {
	skip: number;
	take: number;
} {
	return {
		skip: (input.page - 1) * input.pageSize,
		take: input.pageSize,
	};
}

/**
 * Resolves the requested sort column against the columns a module actually
 * allows, so `?sort=` can never reach Prisma as an arbitrary field name.
 *
 * `orderBy` entries are spelled out per module rather than built from the
 * column id, because sorting by a relation (`company.name`) or an aggregate is
 * not a flat `{ [id]: dir }`.
 */
export function resolveOrderBy<TOrderBy>(
	input: Pick<ListInput, "sort" | "dir">,
	columns: Record<string, (dir: "asc" | "desc") => TOrderBy>,
	fallback: TOrderBy,
): TOrderBy {
	const column = columns[input.sort];
	return column ? column(input.dir) : fallback;
}

/**
 * Turns a `groupBy` result into `{ value: count }`.
 *
 * Rows whose grouped value is null are dropped unless `nullKey` is given —
 * "unassigned" is a facet worth offering, "(blank industry)" usually is not.
 */
export function countsByKey<
	TKey extends string,
	TGroup extends { _count: { _all: number } } & {
		[K in TKey]?: string | null;
	},
>(groups: TGroup[], key: TKey, nullKey?: string): Record<string, number> {
	const counts: Record<string, number> = {};

	for (const group of groups) {
		const value = group[key] ?? nullKey;
		if (value == null) continue;
		counts[value] = (counts[value] ?? 0) + group._count._all;
	}

	return counts;
}

/** The facet value meaning "no filter". Every list procedure defaults to it. */
export const FACET_ALL = "all";

/** The facet value meaning "nobody owns this". */
export const FACET_UNASSIGNED = "unassigned";

/**
 * `ownerId` filter for an owner facet selection.
 *
 * Returns `undefined` for "all" so the caller can spread it into a `where`
 * without a branch.
 */
export function ownerFilter(
	value: string,
): { ownerId: string | null } | undefined {
	if (value === FACET_ALL) return undefined;
	return { ownerId: value === FACET_UNASSIGNED ? null : value };
}
