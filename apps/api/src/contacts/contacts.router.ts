import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	contactCreateInput,
	contactIdInput,
	contactListInput,
	contactUpdateArgs,
} from "./contacts.contracts";
import { ContactsService } from "./contacts.service";

@Router({ alias: "contacts" })
@UseMiddlewares(AuthMiddleware)
export class ContactsRouter {
	constructor(
		@Inject(ContactsService) private readonly contacts: ContactsService,
	) {}

	@Query({ input: contactListInput })
	async list(@Input() input: z.infer<typeof contactListInput>) {
		return this.contacts.list(input);
	}

	@Query({ input: contactIdInput })
	async byId(@Input("id") id: string) {
		return this.contacts.byId(id);
	}

	@Mutation({ input: contactCreateInput })
	async create(@Input() input: z.infer<typeof contactCreateInput>) {
		return this.contacts.create(input);
	}

	@Mutation({ input: contactUpdateArgs })
	async update(@Input() input: z.infer<typeof contactUpdateArgs>) {
		return this.contacts.update(input.id, input.data);
	}
}
