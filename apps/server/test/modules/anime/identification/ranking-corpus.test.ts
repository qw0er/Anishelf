import { expect, test, vi } from "vitest";
import { rankCandidates } from "../../../../src/modules/anime/identification/domain/matching.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import {
	evaluateRankingCorpus,
	loadRankingCorpus,
	validateRankingCorpus,
} from "../../../support/anime-ranking-corpus.js";

const corpus = await loadRankingCorpus();
function first<T>(items: readonly T[]): T {
	const item = items[0];
	if (!item) throw new Error("Missing ranking fixture.");
	return item;
}
function sample() {
	return structuredClone({ ...corpus, cases: [first(corpus.cases)] });
}

test("retains standalone evidence, independent work labels and complete candidate pools", () => {
	expect(corpus.cases).toHaveLength(379);
	expect(
		corpus.cases.filter((entry) => entry.expected.workId !== null),
	).toHaveLength(288);
	expect(corpus.pools.map((pool) => pool.works.length)).toEqual([20, 2]);
	expect(corpus.cases.filter((entry) => entry.group === "base")).toHaveLength(
		369,
	);
	expect(
		corpus.cases.filter((entry) => entry.group === "reported"),
	).toHaveLength(10);
	expect(corpus.evidenceOrigin.kind).toBe("parser-snapshot");
	for (const entry of corpus.cases) {
		expect(entry.expected).not.toHaveProperty("episodes");
		expect(entry.evidence).not.toHaveProperty("workId");
	}
});

test("runs production ranking on frozen inputs from each candidate pool", () => {
	const cases = corpus.pools.map((pool) => {
		const entry = corpus.cases.find((entry) => entry.poolId === pool.id);
		if (!entry) throw new Error("Missing pool input.");
		return entry;
	});
	const report = evaluateRankingCorpus({ ...corpus, cases });
	expect(report.summary).toMatchObject({
		total: 2,
		evaluated: 2,
		unscored: 0,
		runtimeErrors: 0,
	});
	expect(report.rows).toHaveLength(2);
	expect(report.groups.base).toMatchObject({ total: 1, evaluated: 1 });
	expect(report.groups.reported).toMatchObject({ total: 1, evaluated: 1 });
	for (const row of report.rows) {
		expect(row.candidates.length).toBeGreaterThan(0);
		expect(row.candidates.length).toBeLessThanOrEqual(10);
		for (const candidate of row.candidates) {
			expect(candidate.workId).not.toBeNull();
			expect(Number.isFinite(candidate.score)).toBe(true);
		}
	}
});

test("uses frozen evidence without invoking file extraction or network requests", () => {
	const extraction = vi
		.spyOn(AnitomyIdentificationParser.prototype, "extract")
		.mockImplementation(() => {
			throw new Error("Extraction must not run.");
		});
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Network must not run."));
	try {
		const report = evaluateRankingCorpus(sample());
		expect(report.summary).toMatchObject({ passed: 1, runtimeErrors: 0 });
		expect(extraction).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		extraction.mockRestore();
		fetch.mockRestore();
	}
});

test("changing the expected answer cannot filter or reorder the inputs supplied to ranking", () => {
	const input = sample();
	const calls: unknown[] = [];
	const rank = vi.fn<typeof rankCandidates>((evidence, works) => {
		calls.push(structuredClone({ evidence, works }));
		return rankCandidates(evidence, works);
	});
	const original = evaluateRankingCorpus(input, {
		version: "instrumented",
		rank,
	});
	const pool = first(input.pools);
	const alternative = pool.works.find(
		(work) => work.workId !== first(input.cases).expected.workId,
	);
	if (!alternative) throw new Error("Missing competing work.");
	first(input.cases).expected.workId = alternative.workId;
	const changed = evaluateRankingCorpus(input, {
		version: "instrumented",
		rank,
	});
	expect(calls[0]).toEqual(calls[1]);
	expect(rank.mock.calls[0]?.[1]).toHaveLength(20);
	expect(original.summary.passed).toBe(1);
	expect(changed.summary.failed).toBe(1);
	expect(original.rows[0]?.candidates).toEqual(changed.rows[0]?.candidates);
});

test("reports top-1, top-5 and reciprocal rank separately", () => {
	const input = sample();
	const report = evaluateRankingCorpus(input, {
		version: "swapped-ranker",
		rank(evidence, works) {
			const ranked = rankCandidates(evidence, works);
			const [best, next, ...rest] = ranked;
			if (!best || !next) throw new Error("Missing ranking candidates.");
			return [next, best, ...rest];
		},
	});
	expect(report.summary).toMatchObject({
		evaluated: 1,
		failed: 1,
		top1: 0,
		top5: 1,
		meanReciprocalRank: 0.5,
	});
	expect(report.rows[0]?.rank).toBe(2);
	for (const value of Object.values(report.byTag)) expect(value.failed).toBe(1);
});

test("missing ranked targets remain in metric denominators", () => {
	const report = evaluateRankingCorpus(sample(), {
		version: "empty",
		rank: () => [],
	});
	expect(report.summary).toMatchObject({
		evaluated: 1,
		failed: 1,
		top1: 0,
		top5: 0,
		missingFromRanked: 1,
		meanReciprocalRank: 0,
		runtimeErrors: 0,
	});
});

test("unknown identity labels are unscored rather than rejection tests or successful matches", () => {
	const input = sample();
	first(input.cases).expected.workId = null;
	first(input.cases).sourceDecision = "review";
	const report = evaluateRankingCorpus(input);
	expect(report.summary).toMatchObject({
		total: 1,
		evaluated: 0,
		passed: 0,
		failed: 0,
		unscored: 1,
		meanReciprocalRank: null,
	});
	expect(report.rows[0]?.candidates.length).toBeGreaterThan(0);
	expect(report.rows[0]?.top1).toBe(false);
});

test("equal top scores are visible without claiming automatic work confirmation", () => {
	const report = evaluateRankingCorpus(sample(), {
		version: "tied",
		rank(evidence, works) {
			return rankCandidates(evidence, works).map((candidate) => ({
				...candidate,
				score: 100,
			}));
		},
	});
	expect(report.summary.topScoreTies).toBe(1);
	expect(report.rows[0]?.topScoreTied).toBe(true);
	expect(report.rows[0]).not.toHaveProperty("admittedWorkId");
});

test("protects the frozen corpus from ranker input mutations", () => {
	const input = sample();
	const before = structuredClone(input);
	evaluateRankingCorpus(input, {
		version: "mutating",
		rank(evidence, works) {
			evidence.titles.length = 0;
			first(works).titles.length = 0;
			return [];
		},
	});
	expect(input).toEqual(before);
});

test.each(["exception", "unknown-reference", "duplicate", "nonfinite-score"])(
	"records %s ranking failures without excluding the sample",
	(mode) => {
		const report = evaluateRankingCorpus(sample(), {
			version: "broken",
			rank(evidence, works) {
				if (mode === "exception") throw new Error("Ranking failed.");
				const candidate = first(rankCandidates(evidence, works));
				if (mode === "unknown-reference")
					return [
						{
							...candidate,
							work: { ...candidate.work, reference: { id: "unknown" } },
						},
					];
				if (mode === "duplicate") return [candidate, candidate];
				return [{ ...candidate, score: Number.NaN }];
			},
		});
		expect(report.summary).toMatchObject({
			total: 1,
			evaluated: 1,
			failed: 1,
			runtimeErrors: 1,
			meanReciprocalRank: 0,
		});
		expect(report.rows[0]?.error).not.toBeNull();
	},
);

test("runtime failures on unlabelled cases still fail the evaluation", () => {
	const input = sample();
	first(input.cases).expected.workId = null;
	const report = evaluateRankingCorpus(input, {
		version: "broken",
		rank: () => {
			throw new Error("Ranking failed.");
		},
	});
	expect(report.summary).toMatchObject({
		total: 1,
		evaluated: 0,
		failed: 1,
		runtimeErrors: 1,
		unscored: 0,
	});
});

test("rejects broken pool references, duplicate identities and inconsistent evidence provenance", () => {
	const input = sample();
	first(input.cases).poolId = "missing";
	expect(() => validateRankingCorpus(input)).toThrow("Unknown ranking pool");
	const absent = sample();
	first(absent.cases).expected.workId = "absent";
	expect(() => validateRankingCorpus(absent)).toThrow(
		"absent from ranking pool",
	);
	const duplicate = sample();
	first(duplicate.pools).works.push(first(first(duplicate.pools).works));
	expect(() => validateRankingCorpus(duplicate)).toThrow("Duplicate");
	const stale = sample();
	first(stale.cases).evidence.normalizationVersion = "wrong";
	expect(() => validateRankingCorpus(stale)).toThrow("parser version");
	expect(() => validateRankingCorpus({ ...corpus, cases: [] })).toThrow(
		"schema",
	);
});
