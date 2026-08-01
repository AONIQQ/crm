import "@crm/env/load";

import { defineAgent } from "eve";
import { capabilities } from "./lib/capabilities";

/**
 * The people-research agent.
 *
 * Sonnet rather than a frontier model: the hard part here is not reasoning, it
 * is refusing to accept a plausible-looking wrong answer, and that is enforced
 * by the tools and the skill rather than by model strength. Revisit if the
 * identity-matching evals say otherwise.
 *
 * A plain model id routes through the Vercel AI Gateway, authenticated by
 * project OIDC — so on Vercel there is no provider key to manage. Elsewhere,
 * set `AI_GATEWAY_API_KEY`.
 */

/**
 * Says which outside sources are on, once, at startup.
 *
 * Every one of them is optional and the agent is designed to run with none, so
 * the thing a self-hoster needs is not a warning — it is a plain statement of
 * what this install can see, printed where they are already looking. Silence
 * would leave "the agent found nothing" and "the agent had nowhere to look"
 * indistinguishable.
 */
for (const capability of capabilities()) {
	console.log(
		`[agent] ${capability.enabled ? "on " : "off"}  ${capability.label} (${capability.env})`,
	);
}

export default defineAgent({
	model: "anthropic/claude-sonnet-5",
});
