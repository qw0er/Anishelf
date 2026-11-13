import { expect, test } from "vitest";
import {
	evaluateDiscoveryCorpus,
	loadDiscoveryCorpus,
	validateDiscoveryCorpus,
} from "../../../support/acquisition-discovery-corpus.js";

const corpus = await loadDiscoveryCorpus();

test("six discovery scenarios exercise production transport and search offline", async () => {
	expect(corpus.entries).toHaveLength(3);
	const report = await evaluateDiscoveryCorpus(corpus);
	expect(report).toMatchObject({ total: 6, passed: 6, failed: 0 });
	expect(
		report.rows.find((row) => row.id === "later-page")?.candidateIds,
	).toEqual(["unrelated", "frieren-2"]);
});

test("expected candidates cannot control actual search results", async () => {
	const input = structuredClone(corpus);
	input.cases = input.cases.slice(0, 1);
	const entry = input.cases[0];
	if (!entry) throw new Error("Missing case.");
	entry.expectedEntries = [];
	const report = await evaluateDiscoveryCorpus(input);
	expect(report.rows[0]).toMatchObject({
		candidateIds: ["unrelated", "frieren"],
		failures: ["entries"],
		passed: false,
	});
});

test("an unrecorded request fails instead of becoming an empty search", async () => {
	const input = structuredClone(corpus);
	input.cases = input.cases.slice(0, 1);
	const entry = input.cases[0];
	if (!entry) throw new Error("Missing case.");
	entry.pages = [];
	const report = await evaluateDiscoveryCorpus(input);
	expect(report.failed).toBe(1);
	expect(report.rows[0]?.error).toBeTruthy();
});

test("fixture validation rejects missing publications and duplicate requests", () => {
	const input = structuredClone(corpus);
	const entry = input.cases[0];
	const page = entry?.pages[0];
	if (!entry || !page) throw new Error("Missing case/page.");
	entry.pages.push(page);
	expect(() => validateDiscoveryCorpus(input)).toThrow(
		"Duplicate discovery request",
	);
	page.entries.push("missing-publication");
	expect(() => validateDiscoveryCorpus(input)).toThrow("Unknown publication");
});
