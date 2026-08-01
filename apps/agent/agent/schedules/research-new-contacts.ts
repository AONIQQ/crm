import { defineSchedule } from "eve/schedules";

/**
 * Works through contacts the Gmail and Calendar sync created but could not
 * name.
 *
 * A markdown schedule rather than a `run` handler: the batch selection is a
 * tool call, so there is nothing for TypeScript to decide before the agent
 * starts. Task mode — it runs to completion and the output is discarded; what
 * persists is what the tools wrote.
 *
 * On Vercel this becomes a Cron Job, evaluated in UTC. `eve dev` never fires
 * schedules; use the dispatch route to trigger one while iterating.
 */
export default defineSchedule({
	cron: "*/15 * * * *",
	markdown: `
Identify the CRM contacts that are still named after their email address.

1. Call \`list_contacts_to_research\` with a limit of 10.
2. If it returns nothing, stop. Do not go looking for other work.
3. For each contact, follow the \`identity-matching\` skill exactly:
   resolve candidates, verify each with \`get_linkedin_profile\`, and only
   write a match whose verdict is \`high\`.
4. When you identify somebody, call \`update_contact\` with the name and title
   from their profile and the profile URL as the source.
5. When you cannot identify somebody, leave them alone. Do not lower the bar,
   do not write a partial guess, and do not write a note saying you failed.

Do not research companies or write briefings in this run — this schedule is
only for putting real names to addresses.
`.trim(),
});
