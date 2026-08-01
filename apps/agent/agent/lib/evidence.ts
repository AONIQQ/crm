import { FactBand } from "@crm/db";

/**
 * How sure we are, and why.
 *
 * The rule this exists to enforce is that a score is never asserted — not by
 * the model, not by a tool author. A score is *derived* from a list of things
 * that were actually observed, each of which names what it is and where it came
 * from. That makes two otherwise impossible things possible: telling a rep why
 * a field says what it says, and re-calibrating every band in the database
 * without re-running a single lookup.
 *
 * The weights below are starting values to be moved by evals, not truths. What
 * is *not* negotiable is the shape: a primary source is required before
 * anything is written automatically, and a contradiction is never averaged
 * away.
 */

export type EvidenceKind =
	| "profile.email-match"
	| "linkedin.employer-and-name"
	| "crm.thread-reply"
	| "crm.signature-block"
	| "github.account-identity"
	| "crm.meeting-attendance"
	| "web.cited-claim"
	| "handle.name-form"
	| "search.cites-profile"
	| "employer-only"
	| "contradiction";

type Weighting = {
	weight: number;
	/**
	 * Whether this evidence can carry a fact on its own.
	 *
	 * Only sources that identify *this person* qualify. Three non-primary
	 * signals multiply to a confident-looking number and remain three weak
	 * signals, which is the arithmetic that would otherwise let "a handle that
	 * looks like their name" become a written fact.
	 */
	primary: boolean;
	/** Shown to a rep in the provenance tooltip. Written for them, not for us. */
	label: string;
};

export const WEIGHTS: Record<EvidenceKind, Weighting> = {
	"profile.email-match": {
		weight: 0.95,
		primary: true,
		label: "their email address is on the profile",
	},
	"linkedin.employer-and-name": {
		weight: 0.85,
		primary: true,
		label: "LinkedIn: employer and name both match",
	},
	// Ours, and near the top. A person replying on a thread is proof of identity
	// that no data vendor can sell us, because it happened in our own mailbox.
	"crm.thread-reply": {
		weight: 0.85,
		primary: true,
		label: "they replied on a thread we have",
	},
	"crm.signature-block": {
		weight: 0.8,
		primary: true,
		label: "their own email signature says so",
	},
	"github.account-identity": {
		weight: 0.8,
		primary: true,
		label: "the GitHub account names them or their employer",
	},
	"crm.meeting-attendance": {
		weight: 0.7,
		primary: true,
		label: "they attended a meeting on our calendar",
	},
	"web.cited-claim": {
		weight: 0.4,
		primary: false,
		label: "a cited web source states it",
	},
	"handle.name-form": {
		weight: 0.35,
		primary: false,
		label: "the handle is a form of their name",
	},
	"search.cites-profile": {
		weight: 0.35,
		primary: false,
		label: "a search for them cites this profile",
	},
	"employer-only": {
		weight: 0.2,
		primary: false,
		label: "the employer matches, the name does not",
	},
	// Not evidence for anything — evidence that something is wrong.
	contradiction: {
		weight: 0,
		primary: false,
		label: "another source disagrees",
	},
};

export type Evidence = {
	kind: EvidenceKind;
	/** What was actually seen, in a rep's words. */
	detail: string;
	sourceUrl?: string;
};

export type Scored = {
	score: number;
	band: FactBand | null;
	hasPrimary: boolean;
	/** Why it landed where it did — the sentence shown under a proposal. */
	rationale: string;
};

/** Nothing is certain, so nothing scores 1. */
const CEILING = 0.99;

/** A contradiction cannot be outvoted, only investigated. */
const CONTRADICTED = 0.45;

export const BAND_FLOOR = { VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 };

/**
 * Combines independent evidence.
 *
 * `1 − Π(1 − wᵢ)` — the probability that at least one of them is right, if they
 * were independent and calibrated. They are neither, which is why §9's evals
 * exist and why the number is rendered as a word.
 */
export function scoreEvidence(evidence: Evidence[]): Scored {
	if (evidence.length === 0) {
		return {
			score: 0,
			band: null,
			hasPrimary: false,
			rationale: "No evidence.",
		};
	}

	const contradicted = evidence.some((item) => item.kind === "contradiction");
	const hasPrimary = evidence.some((item) => WEIGHTS[item.kind].primary);

	const combined = evidence.reduce(
		(remaining, item) => remaining * (1 - WEIGHTS[item.kind].weight),
		1,
	);

	let score = Math.min(CEILING, 1 - combined);
	if (contradicted) score = Math.min(score, CONTRADICTED);

	return {
		score,
		band: bandFor(score, hasPrimary),
		hasPrimary,
		rationale: rationaleFor(evidence, contradicted, hasPrimary),
	};
}

/**
 * The band, which is the behaviour.
 *
 * `VERIFIED` needs a primary source *and* the score — a fact good enough to
 * write without asking is a fact somebody's own page, mailbox or profile
 * asserts.
 */
export function bandFor(score: number, hasPrimary: boolean): FactBand | null {
	if (score >= BAND_FLOOR.VERIFIED && hasPrimary) return FactBand.VERIFIED;
	if (score >= BAND_FLOOR.PROBABLE) return FactBand.PROBABLE;
	if (score >= BAND_FLOOR.POSSIBLE) return FactBand.POSSIBLE;
	return null;
}

function rationaleFor(
	evidence: Evidence[],
	contradicted: boolean,
	hasPrimary: boolean,
): string {
	const reasons = evidence
		.filter((item) => item.kind !== "contradiction")
		.map((item) => WEIGHTS[item.kind].label);

	if (contradicted) {
		const clash = evidence.find((item) => item.kind === "contradiction");
		return `Held: ${clash?.detail ?? "sources disagree"}.`;
	}

	if (reasons.length === 0) return "No supporting evidence.";

	const list = joinWords(reasons);
	return hasPrimary
		? capitalise(list)
		: `${capitalise(list)} — but nothing that identifies them directly.`;
}

function joinWords(words: string[]): string {
	if (words.length === 1) return words[0] as string;
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function capitalise(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
