import type { Approval } from "eve/tools";

export function isAutomated(session: {
	auth: {
		current?: {
			authenticator?: string;
			principalId?: string;
			principalType?: string;
		} | null;
	};
}): boolean {
	const auth = session.auth.current;
	return (
		auth?.authenticator === "app" &&
		auth.principalId === "eve:app" &&
		auth.principalType === "runtime"
	);
}

export function sensitiveWrite(instead: string): Approval {
	return ({ session }) =>
		isAutomated(session)
			? {
					type: "denied" as const,
					reason: `Not something to do unattended. ${instead}`,
				}
			: "user-approval";
}
