import type { Session, SessionUser } from "@crm/auth";
import type { Request } from "express";

export type BaseTrpcContext = {
	req?: Request;
	session: Session | null;
};

/** What every procedure behind `AuthMiddleware` sees. */
export type AuthedTrpcContext = BaseTrpcContext & {
	user: SessionUser;
};
