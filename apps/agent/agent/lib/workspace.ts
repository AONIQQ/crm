import { db } from "@crm/db";
import {
	readWorkspaceIdentity,
	type WorkspaceIdentity,
} from "@crm/db/workspace";

export type { WorkspaceIdentity };

export async function identity(): Promise<WorkspaceIdentity | null> {
	try {
		return await readWorkspaceIdentity(db);
	} catch (error) {
		console.error("[agent] could not read who we are", error);
		return null;
	}
}

export function usMarkdown(us: WorkspaceIdentity | null): string {
	if (!us) return "";

	const lines = ["## Who we are", ""];

	lines.push(
		`You work for **${us.name}**${us.website ? ` (${us.website})` : ""}.`,
	);

	if (!us.profile) {
		lines.push(
			"Nothing else about us has been researched yet, so do not guess at what",
			"we sell.",
		);
		return lines.join("\n");
	}

	lines.push(us.profile.narrative, "");

	const { sells, sellsTo, edge } = us.profile.sections;
	if (sells) lines.push(`- **We sell:** ${sells}`);
	if (sellsTo) lines.push(`- **To:** ${sellsTo}`);
	if (edge) lines.push(`- **Picked over the alternatives for:** ${edge}`);

	lines.push(
		"",
		"That is context, not a script. When you brief a rep, say what this record",
		"means for us — a fit, a competitor, a partner, or nothing worth saying —",
		"and never write a pitch: the rep already knows what we sell.",
	);

	return lines.join("\n");
}

export async function ourWebsite(): Promise<string | null> {
	return (await identity())?.website ?? null;
}
