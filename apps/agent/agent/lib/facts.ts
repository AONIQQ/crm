import { db, FactBand, FactStatus } from "@crm/db";
import { type Evidence, scoreEvidence } from "./evidence";
import { currentFocus } from "./focus";
import { isDerivedName, splitName } from "./names";

/**
 * The only way a claim reaches a contact record.
 *
 * Three rules live here rather than in a prompt, because a rule the model is
 * asked to follow is a rule the model can talk itself out of:
 *
 * 1. **A human outranks the agent.** A value on the record with no fact behind
 *    it was typed by a person, and is never overwritten.
 * 2. **A dismissal is final.** Once a rep has said no to a value, it is not
 *    offered again — otherwise every run re-proposes it and the suggestion
 *    becomes something reps click through without reading.
 * 3. **Nothing is written without a primary source**, whatever the arithmetic
 *    says. Enforced by `bandFor`, restated here because it is the rule that
 *    stops a plausible stranger becoming a customer record.
 */

/**
 * The fields a fact may be about.
 *
 * `column` is the `Contact` field an applied fact writes through to; the ones
 * without a column are true of the person but have nowhere on the record to
 * live, so they are read straight from the fact by the background panel. That
 * is deliberate: `employer` as a fact rather than a column is what makes a job
 * change a superseded row instead of a diffing job.
 */
const FIELDS = {
	/**
	 * Their actual name. Applied by splitting into `firstName`/`lastName`, and
	 * guarded differently from everything else — see `humanOwns`.
	 */
	name: { column: null },
	title: { column: "title" },
	linkedinUrl: { column: "linkedinUrl" },
	twitterUrl: { column: "twitterUrl" },
	githubUrl: { column: "githubUrl" },
	employer: { column: null },
	seniority: { column: null },
	function: { column: null },
	location: { column: null },
	tenure: { column: null },
} as const;

export type FactField = keyof typeof FIELDS;

export const FACT_FIELDS = Object.keys(FIELDS) as FactField[];

export type RecordFactInput = {
	contactId: string;
	field: FactField;
	value: string;
	evidence: Evidence[];
	method: string;
	sourceUrl?: string;
};

export type RecordFactResult = {
	stored: boolean;
	applied: boolean;
	band: FactBand | null;
	score: number;
	rationale: string;
	/** Why nothing happened, when nothing happened. Written for the model. */
	reason?: string;
};

export async function recordFact(
	input: RecordFactInput,
): Promise<RecordFactResult> {
	const { contactId, field, value } = input;
	const trimmed = value.trim();

	const scored = scoreEvidence(input.evidence);
	const base = {
		score: scored.score,
		band: scored.band,
		rationale: scored.rationale,
	};

	if (!trimmed) {
		return { ...base, stored: false, applied: false, reason: "Empty value." };
	}

	if (scored.band === null) {
		return {
			...base,
			stored: false,
			applied: false,
			reason:
				"Below the floor for keeping — not stored. Find a source that identifies them, or leave the field alone.",
		};
	}

	const contact = await db.contact.findUnique({
		where: { id: contactId },
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			title: true,
			linkedinUrl: true,
			twitterUrl: true,
			githubUrl: true,
		},
	});

	if (!contact) {
		return {
			...base,
			stored: false,
			applied: false,
			reason: "No such contact.",
		};
	}

	const existing = await db.contactFact.findMany({
		where: { contactId, field },
		select: { id: true, value: true, status: true },
	});

	if (
		existing.some(
			(fact) =>
				fact.status === FactStatus.DISMISSED && sameValue(fact.value, trimmed),
		)
	) {
		return {
			...base,
			stored: false,
			applied: false,
			reason:
				"A person has already dismissed this exact value. Do not offer it again.",
		};
	}

	const currentApplied = existing.find(
		(fact) => fact.status === FactStatus.APPLIED,
	);

	if (currentApplied && sameValue(currentApplied.value, trimmed)) {
		return {
			...base,
			stored: false,
			applied: false,
			reason: "Already on the record, from this same source. Nothing changed.",
		};
	}

	const column = FIELDS[field].column;

	if (
		humanOwns({ field, column, contact, hasAgentFact: Boolean(currentApplied) })
	) {
		return {
			...base,
			stored: false,
			applied: false,
			reason: `A person already filled in ${field}. That outranks anything found on the web.`,
		};
	}

	const applies = scored.band === FactBand.VERIFIED;
	const sessionId = currentFocus().sessionId;

	await db.$transaction(async (tx) => {
		if (applies && currentApplied) {
			// The old value is not deleted — it is history, and for `employer` it
			// is the job change itself.
			await tx.contactFact.update({
				where: { id: currentApplied.id },
				data: { status: FactStatus.SUPERSEDED, supersededAt: new Date() },
			});
		}

		await tx.contactFact.create({
			data: {
				contactId,
				field,
				value: trimmed,
				score: scored.score,
				band: scored.band as FactBand,
				evidence: input.evidence as unknown as object,
				method: input.method,
				sourceUrl: input.sourceUrl ?? null,
				sessionId,
				status: applies ? FactStatus.APPLIED : FactStatus.PROPOSED,
			},
		});

		if (!applies) return;

		if (column) {
			await tx.contact.update({
				where: { id: contactId },
				data: { [column]: trimmed },
			});
		}

		if (field === "name") {
			const split = splitName(trimmed);
			if (split) {
				await tx.contact.update({
					where: { id: contactId },
					data: { firstName: split.firstName, lastName: split.lastName },
				});
			}
		}
	});

	return {
		...base,
		stored: true,
		applied: applies,
		reason: applies
			? undefined
			: "Kept as a proposal for a rep to accept or dismiss. This is a normal outcome, not a failure — do not try to raise the score.",
	};
}

/** Whether a job change just happened: an applied `employer` fact superseded. */
export async function lastEmployerChange(contactId: string) {
	const [previous, current] = await Promise.all([
		db.contactFact.findFirst({
			where: { contactId, field: "employer", status: FactStatus.SUPERSEDED },
			orderBy: { supersededAt: "desc" },
			select: { value: true, supersededAt: true },
		}),
		db.contactFact.findFirst({
			where: { contactId, field: "employer", status: FactStatus.APPLIED },
			orderBy: { observedAt: "desc" },
			select: { value: true, observedAt: true, sourceUrl: true },
		}),
	]);

	if (!previous || !current || sameValue(previous.value, current.value)) {
		return null;
	}

	return {
		from: previous.value,
		to: current.value,
		observedAt: current.observedAt,
		sourceUrl: current.sourceUrl,
	};
}

export type BriefSections = {
	currentRole?: string;
	tenure?: string;
	previousRoles?: string[];
	seniority?: string;
	function?: string;
	location?: string;
};

export async function writeBrief(input: {
	contactId: string;
	narrative: string;
	sections: BriefSections;
	evidence: Evidence[];
	sourceUrl?: string;
}): Promise<{ written: boolean; score: number; reason?: string }> {
	const scored = scoreEvidence(input.evidence);

	if (scored.band === null) {
		return {
			written: false,
			score: scored.score,
			reason: "Nothing here is sourced well enough to put on the record.",
		};
	}

	const data = {
		narrative: input.narrative.trim(),
		sections: input.sections as unknown as object,
		score: scored.score,
		sourceUrl: input.sourceUrl ?? null,
		sessionId: currentFocus().sessionId,
		refreshedAt: new Date(),
	};

	await db.contactBrief.upsert({
		where: { contactId: input.contactId },
		create: { contactId: input.contactId, ...data },
		update: data,
	});

	return { written: true, score: scored.score };
}

/**
 * Whether the value already there belongs to a person rather than to us.
 *
 * For ordinary fields the test is simple: something is in the column and no
 * applied fact explains it, so a human typed it.
 *
 * A name needs a different test, because the sync always writes one. `Pmarchetti`
 * is a placeholder derived from `pmarchetti@fernhill.com` and is ours to replace;
 * anything that is not derived came from a mail header or a person, and is not.
 */
function humanOwns({
	field,
	column,
	contact,
	hasAgentFact,
}: {
	field: FactField;
	column: string | null;
	contact: {
		email: string | null;
		firstName: string;
		lastName: string | null;
	} & Record<string, unknown>;
	hasAgentFact: boolean;
}): boolean {
	if (field === "name") {
		return !isDerivedName(contact.email, contact.firstName, contact.lastName);
	}

	if (!column || hasAgentFact) return false;

	return Boolean(contact[column]);
}

function sameValue(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}
