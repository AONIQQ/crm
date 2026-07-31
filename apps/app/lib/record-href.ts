/**
 * The URL that opens a record over a list.
 *
 * Records used to be pages, and links to those pages are already in Slack
 * threads and calendar invites. The old routes still exist and redirect here,
 * which is the only reason this is a shared helper rather than a string built
 * where it is needed.
 */
export function recordHref(
	list: "/companies" | "/contacts" | "/deals",
	kind: "company" | "contact" | "deal",
	id: string,
): string {
	return `${list}?${new URLSearchParams({ record: `${kind}:${id}` })}`;
}
