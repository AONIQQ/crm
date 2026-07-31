import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const contactListInput = listInput.extend({
	/** A user id, `"unassigned"`, or `"all"`. */
	owner: z.string().default("all"),
	/** A company id, `"none"`, or `"all"`. */
	company: z.string().default("all"),
});

export type ContactListInput = z.infer<typeof contactListInput>;

/**
 * `email` is unique across the whole table, matching HubSpot, so an import can
 * be re-run without duplicating people. It is optional because a name and a
 * phone number is a real lead.
 */
export const contactCreateInput = z.object({
	firstName: z.string().trim().min(1, "A contact needs a first name."),
	lastName: z.string().trim().optional(),
	email: z.email("That is not an email address.").optional().or(z.literal("")),
	phone: z.string().trim().optional(),
	title: z.string().trim().optional(),
	companyId: z.string().nullable().optional(),
	ownerId: z.string().nullable().optional(),
});

export type ContactCreateInput = z.infer<typeof contactCreateInput>;

/** `undefined` leaves a field alone; `""` clears it. */
export const contactUpdateInput = z.object({
	firstName: z.string().trim().min(1).optional(),
	lastName: z.string().optional(),
	email: z.string().optional(),
	phone: z.string().optional(),
	title: z.string().optional(),
	linkedinUrl: z.string().optional(),
	companyId: z.string().nullable().optional(),
	ownerId: z.string().nullable().optional(),
});

export type ContactUpdateInput = z.infer<typeof contactUpdateInput>;

export const contactUpdateArgs = z.object({
	id: z.string(),
	data: contactUpdateInput,
});

export const contactIdInput = z.object({ id: z.string() });
