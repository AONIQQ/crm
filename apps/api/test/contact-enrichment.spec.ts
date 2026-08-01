import { describe, expect, it } from "bun:test";
import {
	looksLikeSameCompany,
	nameMatchesLocalPart,
	searchTerms,
} from "../src/enrichment/contact-enrichment.service";

describe("searchTerms", () => {
	it("strips the initial off a run-together handle", () => {
		// The case that forced this: searching "abigham" finds nothing, searching
		// "bigham" returns linkedin.com/in/abigailbigham as the first result.
		expect(searchTerms("abigham")).toContain("bigham");
		expect(searchTerms("ymadar")).toContain("madar");
	});

	it("trusts an explicit separator over any guess", () => {
		const terms = searchTerms("jane.doe");
		expect(terms[0]).toBe("jane doe");
		expect(terms).toContain("doe");
	});

	it("tries the whole handle before decomposing it", () => {
		expect(searchTerms("nathan").indexOf("nathan")).toBe(0);
	});

	it("never emits a fragment too short to search usefully", () => {
		expect(searchTerms("abc").every((term) => term.length >= 3)).toBe(true);
		expect(searchTerms("jo")).toEqual([]);
	});
});

describe("looksLikeSameCompany", () => {
	it("matches an employer to the shorter name the CRM holds", () => {
		// Yael Madar's employer reads "Valley Bank"; the CRM knows "Valley".
		expect(looksLikeSameCompany("Valley Bank", "Valley", "valley.com")).toBe(
			true,
		);
		expect(looksLikeSameCompany("HubSpot", "HubSpot", "hubspot.com")).toBe(
			true,
		);
	});

	it("rejects an unrelated employer", () => {
		// The failure this exists to prevent: search handed back Lavazza's CEO for
		// a HubSpot query, and something has to stop him being written down.
		expect(
			looksLikeSameCompany("Lavazza Group", "HubSpot", "hubspot.com"),
		).toBe(false);
		expect(looksLikeSameCompany("", "HubSpot", "hubspot.com")).toBe(false);
	});
});

describe("nameMatchesLocalPart", () => {
	const person = (firstName: string, lastName: string) => ({
		firstName,
		lastName,
	});

	it("accepts the initial-plus-surname form", () => {
		expect(nameMatchesLocalPart(person("Abbie", "Bigham"), "abigham")).toBe(
			true,
		);
		expect(nameMatchesLocalPart(person("Yael", "Madar"), "ymadar")).toBe(true);
	});

	it("accepts first-name-only and run-together forms", () => {
		expect(nameMatchesLocalPart(person("Nathan", "Owen"), "nathan")).toBe(true);
		expect(nameMatchesLocalPart(person("Jane", "Doe"), "janedoe")).toBe(true);
	});

	it("rejects a stranger who merely turned up in the results", () => {
		// This is the guard that keeps Antonio Baravalle from being filed as
		// Abbie Bigham. The name is checked against the address, never derived
		// from it.
		expect(
			nameMatchesLocalPart(person("Antonio", "Baravalle"), "abigham"),
		).toBe(false);
		expect(nameMatchesLocalPart(person("Preeti", "Prajapati"), "ymadar")).toBe(
			false,
		);
	});

	it("rejects when the profile carries no name at all", () => {
		expect(
			nameMatchesLocalPart({ firstName: null, lastName: null }, "abigham"),
		).toBe(false);
	});
});
