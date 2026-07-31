/**
 * A contact's display name.
 *
 * Only `firstName` is required, so the join has to survive a missing surname
 * without leaving a trailing space behind — the table and the record sheet had
 * a copy of this each, which is one copy too many for a rule this small.
 */
export function contactName(contact: {
	firstName: string;
	lastName: string | null;
}): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}
