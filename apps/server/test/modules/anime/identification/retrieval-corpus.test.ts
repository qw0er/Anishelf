import { expect, test, vi } from "vitest";
import { identificationSearchQueries } from "../../../../src/modules/anime/identification/domain/search-queries.js";
import {
	evaluateRetrievalCorpus,
	loadRetrievalCorpus,
	validateRetrievalCorpus,
} from "../../../support/anime-retrieval-corpus.js";

const corpus = await loadRetrievalCorpus();
test("six common cases replay real search IDs without network access", () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Offline only."));
	try {
		expect(corpus.records).toHaveLength(8);
		expect(evaluateRetrievalCorpus(corpus)).toMatchObject({
			total: 6,
			passed: 6,
			failed: 0,
			positives: 5,
			recalled: 5,
			missingRequests: 0,
		});
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
	}
});
test("query planning preserves production order, deduplication and the three-query budget", () => {
	expect(
		identificationSearchQueries({
			titles: ["Ocean", "Ocean", "海洋", "Other"],
			seasons: ["02"],
			parts: ["2"],
		}),
	).toEqual(["Ocean", "Ocean Season 2", "Ocean Part 2"]);
	expect(
		identificationSearchQueries({
			titles: ["Ocean"],
			seasons: ["1", "2"],
			parts: [],
		}),
	).toEqual(["Ocean"]);
});
test("an unrecorded query is a missing replay failure, not an empty search success", () => {
	const report = evaluateRetrievalCorpus(corpus, () => ["not-recorded"]);
	expect(report).toMatchObject({ failed: 6, missingRequests: 6, recalled: 0 });
	expect(report.rows.every((row) => !row.passed)).toBe(true);
});
test("expected identity does not control the replayed candidate pool", () => {
	const input = structuredClone(corpus);
	const entry = input.cases[0];
	if (!entry) throw new Error("Missing case.");
	const original = evaluateRetrievalCorpus(input);
	entry.expectedId = 99999999;
	entry.labelSource = "https://anilist.co/anime/99999999";
	const changed = evaluateRetrievalCorpus(input);
	expect(changed.rows[0]?.candidateIds).toEqual(original.rows[0]?.candidateIds);
	expect(changed.rows[0]?.passed).toBe(false);
});
test("dropping useful queries cannot pass just because a remaining query found the work", () => {
	const report = evaluateRetrievalCorpus(corpus, (input) =>
		identificationSearchQueries(input).slice(0, 1),
	);
	expect(
		report.rows.find((row) => row.id === "multilingual")?.queryContract,
	).toBe(false);
});
test("fixture validation rejects duplicate requests and missing or mismatched pages", () => {
	const record = corpus.records[0];
	if (!record) throw new Error("Missing response.");
	expect(() =>
		validateRetrievalCorpus({
			...corpus,
			records: [...corpus.records, record],
		}),
	).toThrow("Duplicate replay");
	expect(() =>
		validateRetrievalCorpus({ ...corpus, records: corpus.records.slice(1) }),
	).toThrow("Missing expected replay");
	expect(() =>
		validateRetrievalCorpus({
			...corpus,
			records: [{ ...record, page: 2 }, ...corpus.records.slice(1)],
		}),
	).toThrow("Invalid replay page");
});
