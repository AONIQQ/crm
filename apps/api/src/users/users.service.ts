import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export interface UserOption {
	id: string;
	name: string;
	email: string;
	image: string | null;
}

@Injectable()
export class UsersService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * Everyone who can own a company, contact or deal.
	 *
	 * There are no roles here — a user row exists because someone signed in with
	 * a Google account, and that is exactly the set of people work can be
	 * assigned to.
	 */
	async list(): Promise<UserOption[]> {
		return this.db.user.findMany({
			select: { id: true, name: true, email: true, image: true },
			orderBy: [{ name: "asc" }, { email: "asc" }],
		});
	}
}
