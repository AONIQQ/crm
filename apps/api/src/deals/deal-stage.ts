import { DealStage } from "@crm/db";

/**
 * Stages a deal can still be won from. Pipeline value and the forecast are the
 * sum over these.
 */
export const OPEN_DEAL_STAGES = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
] as const;

/**
 * Stages a deal is finished in. `UNQUALIFIED_TO_BUY` belongs here rather than
 * mid-funnel: it is a disqualification, not a step forward, and counting it as
 * open would inflate the pipeline with deals nobody is working.
 */
export const CLOSED_DEAL_STAGES = [
	DealStage.CLOSED_WON,
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

/** Closed stages that need a reason typed in. */
export const LOSING_DEAL_STAGES = [
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

const CLOSED = new Set<DealStage>(CLOSED_DEAL_STAGES);

export function isClosedStage(stage: DealStage): boolean {
	return CLOSED.has(stage);
}

export function isOpenStage(stage: DealStage): boolean {
	return !CLOSED.has(stage);
}
