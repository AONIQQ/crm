/**
 * The shapes inside our `Json` columns.
 *
 * Prisma types a `Json` column as `JsonValue`, which is honest and useless: the
 * column has a shape, three packages depend on it, and the alternative to
 * writing it down once is each of them casting to its own private idea of what
 * is in there. That is exactly how `looksLikeSameCompany` came to exist twice
 * and mean two different things.
 *
 * These live beside the schema because the schema is what guarantees them.
 */

/** One observation behind a `ContactFact`. Weights live with the agent. */
export type FactEvidence = {
	kind: string;
	/** What the source actually said, in a line a rep would understand. */
	detail: string;
	sourceUrl?: string;
};

/** The structured lines under a `ContactBrief`'s narrative. */
export type ContactBriefSections = {
	currentRole?: string;
	tenure?: string;
	previousRoles?: string[];
	seniority?: string;
	function?: string;
	location?: string;
};
