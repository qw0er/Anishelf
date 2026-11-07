import { expect, test, vi } from "vitest";
import type { ExtractionEvidence } from "../../../../src/modules/anime/identification/domain/model.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import {
	evaluateParsingCorpus,
	loadParsingCorpus,
	validateParsingCorpus,
} from "../../../support/anime-parsing-corpus.js";

const corpus = await loadParsingCorpus();
const parser = new AnitomyIdentificationParser();
function first<T>(values: readonly T[]): T {
	const value = values[0];
	if (!value) throw new Error("Missing parsing fixture.");
	return value;
}
function sample() {
	return structuredClone({
		...corpus,
		cases: [
			{
				...first(corpus.cases),
				expected: {},
				inheritedExpected: {},
				relativePath: "Ocean - 01.mkv",
			},
		],
	});
}
function evaluate(
	input: Parameters<typeof evaluateParsingCorpus>[0],
	overrides: Partial<ExtractionEvidence>,
) {
	return evaluateParsingCorpus(input, {
		version: "controlled-output",
		extract(paths) {
			return parser
				.extract(paths)
				.map((evidence) => ({ ...evidence, ...overrides }));
		},
	});
}

test("new accuracy fields have independent reviewed coverage rather than frozen predictions", () => {
	for (const [field, total] of Object.entries({
		titles: 98,
		titleSources: 87,
		parts: 98,
		years: 98,
		numbering: 96,
		selectedEpisodes: 95,
	}))
		expect(
			corpus.cases.filter((entry) => field in entry.expected),
		).toHaveLength(total);
	for (const entry of corpus.cases.filter(
		(entry) => entry.group !== "legacy",
	)) {
		expect(entry.review?.method).toBe("literal-source-review");
		expect(entry.expected).not.toHaveProperty("workId");
		if (entry.group === "reviewed-existing")
			expect(entry.inheritedExpected).toBeDefined();
	}
});

test("captured website paths retain exact source paths, dates and response hashes", () => {
	expect(corpus.sources).toHaveLength(18);
	for (const entry of corpus.cases.filter((entry) => entry.group === "web")) {
		const source = corpus.sources.find(
			(source) => source.id === entry.provenance.sourceId,
		);
		expect(source?.url).toBe(entry.provenance.url);
		expect(source?.observedPath).toBe(entry.relativePath);
		expect(source?.responseSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(Number.isNaN(Date.parse(source?.retrievedAt ?? ""))).toBe(false);
	}
});

test("production parsing satisfies representative real-source title, Part, year and revision assertions", () => {
	const ids = [
		"web-demon-revision",
		"web-major-season",
		"web-eighty-six",
		"web-raw-number-only",
		"web-attack-part2",
		"web-chainsaw-part1",
		"web-solo-year",
	];
	const input = {
		...corpus,
		cases: corpus.cases.filter((entry) => ids.includes(entry.id)),
	};
	const report = evaluateParsingCorpus(input);
	expect(report.summary).toMatchObject({
		total: 7,
		passed: 7,
		failed: 0,
		runtimeErrors: 0,
	});
});

test("required title digits are not removed by fuzzy or punctuation-insensitive comparison", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					titles: {
						required: ["Steins;Gate 0", "86 - Eighty Six"],
						forbidden: ["Group"],
					},
				},
			},
		],
	};
	const report = evaluate(input, {
		titles: ["Steins;Gate", "Eighty Six", "Group"],
	});
	expect(report.rows[0]?.failures).toEqual(["titles"]);
	expect(report.checks.titles).toEqual({
		required: 2,
		matched: 0,
		forbidden: 1,
		violations: 1,
	});
});

test("only explicitly declared surface variants can satisfy a title clause", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					titles: { required: [["Ocean", "Ocean Part 2"]], forbidden: [] },
					parts: [2],
				},
			},
		],
	};
	expect(
		evaluate(input, { titles: ["Ocean Part 2"], parts: ["2"] }).summary.passed,
	).toBe(1);
	expect(
		evaluate(input, { titles: ["Ocean Part 3"], parts: ["2"] }).summary.failed,
	).toBe(1);
	expect(
		evaluate(input, { titles: ["Ocean Part 2"], parts: ["3"] }).rows[0]
			?.failures,
	).toEqual(["parts"]);
});

test("Unicode compatibility and whitespace normalization preserve the title contract", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					titles: { required: ["Ocean 2"], forbidden: [], exact: true },
				},
			},
		],
	};
	expect(evaluate(input, { titles: ["Ｏｃｅａｎ　２"] }).summary.passed).toBe(
		1,
	);
	expect(evaluate(input, { titles: ["Ocean"] }).summary.failed).toBe(1);
	expect(
		evaluate(input, { titles: ["Ocean 2", "Unrelated"] }).summary.failed,
	).toBe(1);
});

test("a correct title at the wrong path source or distance does not satisfy source labels", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					titles: { required: ["Ocean"], forbidden: [] },
					titleSources: {
						required: [
							{ title: "Ocean", mode: "ancestor" as const, distance: 1 },
						],
						forbidden: [
							{ title: "Ocean", mode: "basename" as const, distance: 0 },
						],
					},
				},
			},
		],
	};
	const report = evaluate(input, {
		titles: ["Ocean"],
		titleSources: [
			{ title: "Ocean", mode: "basename", distance: 0 },
			{ title: "Ocean", mode: "ancestor", distance: 0 },
		],
	});
	expect(report.rows[0]?.failures).toEqual(["titleSources"]);
	expect(report.checks.sources).toEqual({
		required: 1,
		matched: 0,
		forbidden: 1,
		violations: 1,
	});
});

test("source title alternatives do not relax source mode or distance", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					titleSources: {
						required: [
							{
								title: ["Ocean", "Ocean Part 2"],
								mode: "ancestor" as const,
								distance: 0,
							},
						],
						forbidden: [],
					},
				},
			},
		],
	};
	expect(
		evaluate(input, {
			titleSources: [{ title: "Ocean Part 2", mode: "ancestor", distance: 0 }],
		}).summary.passed,
	).toBe(1);
	expect(
		evaluate(input, {
			titleSources: [{ title: "Ocean Part 2", mode: "basename", distance: 0 }],
		}).summary.failed,
	).toBe(1);
});

test("raw numbering, chosen numbering and ambiguity are independently scored", () => {
	const base = sample();
	const input = {
		...base,
		cases: [
			{
				...first(base.cases),
				expected: {
					rawEpisodes: [29, 1],
					selectedEpisodes: [1],
					numbering: "single" as const,
					parts: [1, 2],
					years: [2023],
					seasons: [1, 2],
				},
			},
		],
	};
	const report = evaluate(input, {
		rawEpisodes: ["29", "01"],
		selectedEpisodes: ["29"],
		numbering: "ambiguous",
		parts: ["2", "1"],
		years: ["2023"],
		seasons: ["2", "1"],
	});
	expect(report.rows[0]?.failures).toEqual(["selectedEpisodes", "numbering"]);
	expect(report.fields.rawEpisodes).toMatchObject({ total: 1, correct: 1 });
	expect(report.fields.parts).toMatchObject({ total: 1, correct: 1 });
});

test("unknown numeric tokens remain visible rather than becoming JSON null", () => {
	const base = sample();
	const input = {
		...base,
		cases: [{ ...first(base.cases), expected: { rawEpisodes: [1] } }],
	};
	const report = evaluate(input, { rawEpisodes: ["unknown"] });
	expect(report.rows[0]?.actual?.rawEpisodes).toEqual(["unknown"]);
	expect(report.summary.failed).toBe(1);
});

test("sibling batches never mix unrelated immediate parent directories", () => {
	const base = sample();
	const entry = first(base.cases);
	const input = {
		...base,
		cases: [
			{ ...entry, id: "one", relativePath: "One/01.mkv", batch: "mixed" },
			{ ...entry, id: "two", relativePath: "Two/02.mkv", batch: "mixed" },
		],
	};
	const extract = vi.fn((paths: string[]) => parser.extract(paths));
	evaluateParsingCorpus(input, { version: parser.version, extract });
	expect(extract.mock.calls.map(([paths]) => paths)).toEqual([
		["One/01.mkv"],
		["Two/02.mkv"],
	]);
});

test("ordinary tests and evaluation never request a live source refresh", () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Network must not run."));
	try {
		evaluateParsingCorpus(sample());
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
	}
});

test("unreviewed sources, altered captured paths and contradictory assertions are rejected", () => {
	const web = first(corpus.cases.filter((entry) => entry.group === "web"));
	const forged = structuredClone({ ...corpus, cases: [web] });
	first(forged.cases).relativePath = "Invented.mkv";
	expect(() => validateParsingCorpus(forged)).toThrow("Unverified web path");
	const base = sample();
	const missingReview = {
		...base,
		cases: [
			Object.fromEntries(
				Object.entries(first(base.cases)).filter(([key]) => key !== "review"),
			),
		],
	};
	expect(() => validateParsingCorpus(missingReview)).toThrow(
		"Missing parsing review",
	);
	expect(() =>
		validateParsingCorpus({
			...base,
			sources: [...base.sources, first(base.sources)],
		}),
	).toThrow("Duplicate parsing source");
	expect(() =>
		validateParsingCorpus({
			...base,
			cases: [
				{
					...first(base.cases),
					expected: { titles: { required: ["Ocean"], forbidden: ["Ocean"] } },
				},
			],
		}),
	).toThrow("contradictory");
	expect(() =>
		validateParsingCorpus({
			...base,
			cases: [
				{
					...first(base.cases),
					expected: { titleSources: { required: [], forbidden: [] } },
				},
			],
		}),
	).toThrow("contradictory");
});
