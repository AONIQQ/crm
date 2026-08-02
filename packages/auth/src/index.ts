export { type Auth, auth, type Session, type SessionUser } from "./auth";
export {
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	hasSyncScopes,
	IDENTITY_SCOPES,
	parseScopes,
	REQUIRED_SCOPES,
	SYNC_SCOPES,
} from "./scopes";
export { onSignedIn, type SignedInHandler } from "./signed-in";
export {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
	workspaceDomains,
} from "./workspace";
