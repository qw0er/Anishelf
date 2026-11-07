import { expect, test, vi } from "vitest";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import {
	evaluateParsingCorpus,
	loadParsingCorpus,
	validateParsingCorpus,
} from "../../../support/anime-parsing-corpus.js";

const corpus = await loadParsingCorpus();
const parser = new AnitomyIdentificationParser();
function first<T>(items: readonly T[]): T {
	const item = items[0];
	if (!item) throw new Error("Missing parsing fixture.");
	return item;
}
function sample() {
	const entry = corpus.cases[0];
	if (!entry) throw new Error("Missing parsing fixture.");
	return {
		...corpus,
		cases: [
			{
				...entry,
				id: "isolated",
				relativePath: "Show S02/Show - 03v2.mkv",
				batch: null,
				expected: {
					rawEpisodes: [3],
					seasons: [2],
					revision: 2,
					contentKind: "regular" as const,
				},
				unscored: {},
			},
		],
	};
}

test("retains standalone file provenance and parsing labels without work or episode mappings", () => {
	expect(corpus.extractedFrom).toEqual({
		identification: "2026-10-11.2",
		reported: "2026-11-02.1",
	});
	expect(corpus.cases).toHaveLength(409);
	expect(
		corpus.cases.filter((entry) => entry.group === "reviewed-existing"),
	).toHaveLength(68);
	expect(corpus.cases.filter((entry) => entry.group === "web")).toHaveLength(
		18,
	);
	expect(
		corpus.cases.filter((entry) => entry.group === "synthetic-context"),
	).toHaveLength(12);
	expect(
		corpus.cases.filter((entry) => entry.provenance.kind === "torrent-file"),
	).toHaveLength(353);
	expect(
		corpus.cases.filter((entry) => entry.provenance.kind === "synthetic"),
	).toHaveLength(16);
	for (const entry of corpus.cases) {
		expect(entry.expected).not.toHaveProperty("workId");
		expect(entry.expected).not.toHaveProperty("episodes");
		if (entry.provenance.kind === "torrent-file") {
			expect(entry.provenance.sourceId).not.toBeNull();
			expect(entry.provenance.url).toMatch(/^https:\/\//u);
		}
	}
	expect(
		corpus.cases.filter((entry) => entry.provenance.kind === "user-report"),
	).toHaveLength(10);
	expect(
		corpus.cases.filter((entry) => entry.unscored.contentType === "movie"),
	).toHaveLength(14);
});

test("every corpus filename preserves local evidence directly through the production parser", () => {
	const report = evaluateParsingCorpus(corpus);
	expect(report.summary.runtimeErrors).toBe(0);
	expect(report.rows).toHaveLength(409);
	for (const row of report.rows) {
		expect(row.evidence?.relativePath).toBe(row.relativePath);
		expect(row.evidence?.inputs.map((input) => input.mode)).toEqual(
			expect.arrayContaining(["basename", "path", "together"]),
		);
		for (const input of row.evidence?.inputs ?? [])
			for (const element of input.elements)
				expect(Number.isInteger(element.position)).toBe(true);
	}
});

test("evaluates raw numbers, ancestor seasons, content kind and the production revision extractor", () => {
	const report = evaluateParsingCorpus(sample());
	expect(report.summary).toMatchObject({
		total: 1,
		evaluated: 1,
		passed: 1,
		failed: 0,
		unscored: 0,
	});
	expect(report.rows[0]?.actual).toMatchObject({
		rawEpisodes: [3],
		seasons: [2],
		revision: 2,
		contentKind: "regular",
	});
	expect(report.fields).toMatchObject(
		Object.fromEntries(
			["rawEpisodes", "seasons", "contentKind", "revision"].map((field) => [
				field,
				{ total: 1, correct: 1, unlabelled: 0 },
			]),
		),
	);
});

test("counts wrong labels per field and tag instead of accepting parser predictions as answers", () => {
	const input = sample();
	const entry = input.cases[0];
	if (!entry) throw new Error("Missing sample.");
	entry.expected = {
		rawEpisodes: [4],
		seasons: [1],
		revision: 1,
		contentKind: "regular",
	};
	const report = evaluateParsingCorpus(input);
	expect(report.summary.failed).toBe(1);
	expect(report.rows[0]?.failures).toEqual([
		"rawEpisodes",
		"seasons",
		"revision",
	]);
	expect(report.fields.rawEpisodes).toEqual({
		total: 1,
		correct: 0,
		unlabelled: 0,
	});
	for (const counts of Object.values(report.byTag))
		expect(counts.failed).toBe(1);
});

test("unlabelled fields and movie identity are not scored as successful parsing", () => {
	const input = {
		...corpus,
		cases: [
			{
				...first(corpus.cases),
				expected: {},
				unscored: { contentType: "movie" as const },
			},
		],
	};
	const report = evaluateParsingCorpus(input);
	expect(report.summary).toMatchObject({
		evaluated: 0,
		passed: 0,
		unscored: 1,
	});
	for (const counts of Object.values(report.fields))
		expect(counts).toEqual({ total: 0, correct: 0, unlabelled: 1 });
	expect(report.rows[0]?.actual).not.toBeNull();
});

test("conflicting ancestor and leaf seasons cannot satisfy a single-season label", () => {
	const input = sample();
	first(input.cases).relativePath = "Show S01/Show S02E03.mkv";
	const report = evaluateParsingCorpus(input);
	expect(report.rows[0]?.actual?.seasons).toEqual([1, 2]);
	expect(report.rows[0]?.failures).toContain("seasons");
});

test("isolates standalone cases and retains explicit sibling batches", () => {
	const entry = first(sample().cases);
	const input = {
		...corpus,
		cases: [
			{ ...entry, id: "standalone" },
			{ ...entry, id: "sibling-1", batch: "siblings" },
			{
				...entry,
				id: "sibling-2",
				batch: "siblings",
				relativePath: "Show S02/Show - 04.mkv",
			},
		],
	};
	const extract = vi.fn((paths: string[]) => parser.extract(paths));
	evaluateParsingCorpus(input, { version: parser.version, extract });
	expect(extract.mock.calls.map(([paths]) => paths.length)).toEqual([1, 2]);
});

test.each(["throw", "missing", "wrong-path"])(
	"reports %s parser results as failures without reducing denominators",
	(mode) => {
		const report = evaluateParsingCorpus(sample(), {
			version: "broken-parser",
			extract(paths) {
				if (mode === "throw") throw new Error("Parser failed.");
				if (mode === "missing") return [];
				return parser
					.extract(paths)
					.map((entry) => ({ ...entry, relativePath: "wrong.mkv" }));
			},
		});
		expect(report.summary).toMatchObject({
			total: 1,
			failed: 1,
			runtimeErrors: 1,
		});
		expect(report.fields.rawEpisodes).toEqual({
			total: 1,
			correct: 0,
			unlabelled: 0,
		});
	},
);

test("rejects invalid schemas, duplicate IDs and invalid relative paths", () => {
	const entry = first(sample().cases);
	expect(() =>
		validateParsingCorpus({ ...corpus, cases: [entry, entry] }),
	).toThrow("Duplicate");
	expect(() =>
		validateParsingCorpus({
			...corpus,
			cases: [{ ...entry, expected: { workId: "leaked" } }],
		}),
	).toThrow("schema");
	for (const relativePath of [
		"/absolute.mkv",
		"../Show.mkv",
		"Show//01.mkv",
		"Show\\01.mkv",
		"Show\0.mkv",
	])
		expect(() =>
			validateParsingCorpus({ ...corpus, cases: [{ ...entry, relativePath }] }),
		).toThrow("path");
});
