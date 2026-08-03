import { describe, expect, it } from "bun:test";
import {
	canConfigureSso,
	ssoCallbackBase,
	ssoCallbackURL,
	ssoProviderName,
} from "../src/sso";

describe("canConfigureSso", () => {
	it("is the same answer as renaming the workspace", () => {
		expect(canConfigureSso("owner")).toBe(true);
		expect(canConfigureSso("admin")).toBe(true);
		expect(canConfigureSso("member")).toBe(false);
		expect(canConfigureSso(null)).toBe(false);
	});
});

describe("ssoCallbackURL", () => {
	it("hangs off the base the settings page shows", () => {
		expect(ssoCallbackURL("okta")).toBe(`${ssoCallbackBase()}/okta`);
	});

	it("is the path better-auth mounts the callback on", () => {
		expect(new URL(ssoCallbackURL("okta")).pathname).toBe(
			"/api/auth/sso/callback/okta",
		);
	});
});

describe("ssoProviderName", () => {
	it("reads as a button on the sign-in page", () => {
		expect(ssoProviderName("okta")).toBe("Okta");
		expect(ssoProviderName("entra-id")).toBe("Entra Id");
		expect(ssoProviderName("jump_cloud")).toBe("Jump Cloud");
	});

	it("leaves an acronym alone", () => {
		expect(ssoProviderName("ADFS")).toBe("ADFS");
	});
});
