import { z } from "zod";

/**
 * The board shows the open pipeline only.
 *
 * A closed column would be an ever-growing list of things nobody is working,
 * and dragging a card into it needs a reason typed in — which is a dialog, not
 * a drop target. Closing happens from the row menu or the deal page.
 */
export const boardInput = z.object({
	q: z.string().default(""),
	/** A user id, or `"all"`. */
	owner: z.string().default("all"),
	/** Cards per column. The count is always the true total. */
	limit: z.number().int().min(1).max(100).default(50),
});

export type BoardInput = z.infer<typeof boardInput>;
