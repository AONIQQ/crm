import { defineAgent } from "eve";

/**
 * The people-research agent.
 *
 * Sonnet rather than a frontier model: the hard part here is not reasoning, it
 * is refusing to accept a plausible-looking wrong answer, and that is enforced
 * by the tools and the skill rather than by model strength. Revisit if the
 * identity-matching evals say otherwise.
 *
 * A plain model id routes through the Vercel AI Gateway, authenticated by
 * project OIDC — so there is no provider key to manage alongside the two API
 * keys this agent already needs.
 */
export default defineAgent({
	model: "anthropic/claude-sonnet-5",
});
