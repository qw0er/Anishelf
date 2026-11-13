import { expect, test, vi } from "vitest";
import { proposeMapping } from "../../../../src/modules/anime/identification/domain/mapping.js";
import { applyNumberingContext } from "../../../../src/modules/anime/identification/domain/numbering-context.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import {
	evaluateNumberingCorpus,
	loadNumberingCorpus,
	validateNumberingCorpus,
} from "../../../support/anime-numbering-corpus.js";

const corpus = await loadNumberingCorpus();
function first<T>(items: readonly T[]): T {
	const item = items[0];
	if (!item) throw new Error("Missing numbering fixture.");
	return item;
}
function sample(batch = "bounded-range") {
	const cases = corpus.cases.filter(
		(entry) => entry.group === "rules" && entry.batch === batch,
	);
	if (!cases.length) throw new Error("Missing numbering batch.");
	return structuredClone({ ...corpus, cases });
}

test("retains standalone selected works, independent numbering labels and explicit unscored inputs", () => {
	expect(corpus.cases).toHaveLength(453);
	expect(corpus.cases.filter((entry) => entry.expected !== null)).toHaveLength(
		272,
	);
	expect(
		corpus.cases.filter((entry) => entry.group === "scenario"),
	).toHaveLength(50);
	expect(
		corpus.cases.filter(
			(entry) => entry.labelEvidence && entry.group === "base",
		),
	).toHaveLength(40);
	const incompatible = corpus.cases.filter(
		(entry) =>
			entry.basis === "unverified-numbering-system" && entry.numberingEvidence,
	);
	expect(incompatible).toHaveLength(55);
	for (const entry of incompatible) expect(entry.expected).toBeNull();
});

test("all comparable corpus labels pass production mapping without shrinking denominators", () => {
	const report = evaluateNumberingCorpus(corpus);
	expect(report.summary).toMatchObject({
		total: 453,
		evaluated: 272,
		passed: 272,
		failed: 0,
		unscored: 181,
		runtimeErrors: 0,
	});
	expect(report.summary.offset).toEqual({ total: 6, correct: 6 });
	expect(report.groups.rules).toMatchObject({
		total: 24,
		evaluated: 12,
		passed: 12,
	});
	expect(report.byBasis["frozen-season-local-label"]).toMatchObject({
		total: 46,
		passed: 46,
	});
});

test("mapping uses frozen inputs without file extraction or network calls", () => {
	const extraction = vi
		.spyOn(AnitomyIdentificationParser.prototype, "extract")
		.mockImplementation(() => {
			throw new Error("Extraction must not run.");
		});
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Network must not run."));
	try {
		const report = evaluateNumberingCorpus(sample("agreed-anchors"));
		expect(report.summary).toMatchObject({ passed: 1, runtimeErrors: 0 });
		expect(extraction).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		extraction.mockRestore();
		fetch.mockRestore();
	}
});

test("records independent raw and local numbers with directory-anchor provenance", () => {
	const report = evaluateNumberingCorpus(sample("agreed-anchors"));
	const row = report.rows.find((row) => row.id === "rule:agreed-anchors:2");
	expect(row?.rawEpisodes).toEqual(["15"]);
	expect(row?.actual).toEqual({
		targets: [{ kind: "regular", number: "3" }],
		resolved: true,
		offset: -12,
	});
	expect(
		row?.mapping?.numbering?.anchors.map((anchor) => anchor.fileId),
	).toEqual(["rule:agreed-anchors:0", "rule:agreed-anchors:1"]);
});

test.each([
	"conflicting-anchors",
	"cross-directory",
	"unrelated-leaf",
	"duplicate-anchor",
])("keeps %s unresolved without an invented offset", (batch) => {
	const report = evaluateNumberingCorpus(sample(batch));
	const row = report.rows.find((row) => row.expected !== null);
	expect(row?.actual).toEqual({ targets: [], resolved: false, offset: null });
	expect(report.summary.failed).toBe(0);
});

test("a suggested target does not imply that numbering is resolved", () => {
	for (const batch of ["zero-manual", "in-scope-alternative"]) {
		const row = evaluateNumberingCorpus(sample(batch)).rows.find(
			(row) => row.expected !== null,
		);
		expect(row?.actual?.targets).toHaveLength(1);
		expect(row?.actual?.resolved).toBe(false);
		expect(row?.mapping?.unresolved.length).toBeGreaterThan(0);
	}
});

test("a changed expected target cannot affect the mapping input or result", () => {
	const input = sample();
	const calls: unknown[] = [];
	const propose = vi.fn<typeof proposeMapping>((evidence, work) => {
		calls.push(structuredClone({ evidence, work }));
		return proposeMapping(evidence, work);
	});
	const original = evaluateNumberingCorpus(input, {
		propose,
		applyContext: applyNumberingContext,
	});
	const label = first(input.cases).expected;
	if (!label) throw new Error("Missing expected mapping.");
	label.targets = [{ kind: "regular", number: "3" }];
	const changed = evaluateNumberingCorpus(input, {
		propose,
		applyContext: applyNumberingContext,
	});
	expect(calls[0]).toEqual(calls[1]);
	expect(original.rows[0]?.actual).toEqual(changed.rows[0]?.actual);
	expect(changed.rows[0]?.failures).toEqual(["targets"]);
	expect(changed.summary.targets).toEqual({ total: 1, correct: 0 });
});

test("isolates batches even when their paths and selected work agree", () => {
	const input = sample("agreed-anchors");
	first(input.cases).batch = "other-batch";
	const row = evaluateNumberingCorpus(input).rows.find(
		(row) => row.expected !== null,
	);
	expect(row?.actual?.offset).toBeNull();
	expect(row?.status).toBe("failed");
});

test("unlabelled context remains available but is never counted as a passing answer", () => {
	const report = evaluateNumberingCorpus(sample("agreed-anchors"));
	expect(report.summary).toMatchObject({
		total: 3,
		evaluated: 1,
		passed: 1,
		unscored: 2,
	});
	for (const row of report.rows.filter((row) => row.expected === null)) {
		expect(row.actual).not.toBeNull();
		expect(row.status).toBe("unscored");
	}
});

test("an unknown work does not get guessed from the first available candidate", () => {
	const entry = corpus.cases.find((entry) => entry.workId === null);
	if (!entry) throw new Error("Missing unlabelled input.");
	const propose = vi.fn(proposeMapping);
	const applyContext = vi.fn(applyNumberingContext);
	const report = evaluateNumberingCorpus(
		{ ...corpus, cases: [entry] },
		{ propose, applyContext },
	);
	expect(propose).not.toHaveBeenCalled();
	expect(applyContext).not.toHaveBeenCalled();
	expect(report.summary).toMatchObject({
		evaluated: 0,
		passed: 0,
		unscored: 1,
	});
});

test("reports target, resolution and offset correctness independently", () => {
	const report = evaluateNumberingCorpus(sample("agreed-anchors"), {
		propose: proposeMapping,
		applyContext(results) {
			applyNumberingContext(results);
			for (const result of results) {
				const mapping = result.proposals[0]?.mapping;
				if (mapping?.numbering) mapping.numbering.offset = -11;
			}
		},
	});
	expect(report.summary.targets).toEqual({ total: 1, correct: 1 });
	expect(report.summary.resolution).toEqual({ total: 1, correct: 1 });
	expect(report.summary.offset).toEqual({ total: 1, correct: 0 });
	expect(report.summary.failed).toBe(1);
});

test.each(["propose", "context", "missing-result", "foreign-anchor"])(
	"keeps %s runtime failures in labelled denominators",
	(mode) => {
		const report = evaluateNumberingCorpus(sample(), {
			propose(evidence, work) {
				if (mode === "propose") throw new Error("Proposal failed.");
				return proposeMapping(evidence, work);
			},
			applyContext(results) {
				if (mode === "context") throw new Error("Context failed.");
				if (mode === "missing-result") results.length = 0;
				if (mode === "foreign-anchor")
					first(first(results).proposals).mapping.numbering = {
						source: "directory-anchors",
						offset: 0,
						anchors: [{ fileId: "foreign", sourceVersion: "unknown" }],
					};
			},
		});
		expect(report.summary).toMatchObject({
			total: 1,
			evaluated: 1,
			failed: 1,
			runtimeErrors: 1,
		});
		expect(report.summary.targets).toEqual({ total: 1, correct: 0 });
	},
);

test("does not mutate the frozen extraction or selected-work facts", () => {
	const input = sample("agreed-anchors");
	const original = structuredClone(input);
	evaluateNumberingCorpus(input);
	expect(input).toEqual(original);
});

test("rejects missing selected works, stale proof and incompatible unchanged-number labels", () => {
	const missing = sample();
	first(missing.cases).workId = "unknown";
	expect(() => validateNumberingCorpus(missing)).toThrow(
		"Unknown selected work",
	);
	const evidence = sample();
	first(evidence.cases).rankingEvidence = null;
	expect(() => validateNumberingCorpus(evidence)).toThrow(
		"selected-work evidence",
	);
	const duplicate = sample();
	duplicate.cases.push(first(duplicate.cases));
	expect(() => validateNumberingCorpus(duplicate)).toThrow("Duplicate");
	const labelled = corpus.cases.find((entry) => entry.labelEvidence);
	if (!labelled) throw new Error("Missing independent label.");
	const stale = structuredClone({ ...corpus, cases: [labelled] });
	const label = first(stale.cases).labelEvidence;
	if (!label) throw new Error("Missing independent label.");
	label.targets = ["999"];
	expect(() => validateNumberingCorpus(stale)).toThrow(
		"independent numbering label",
	);
	const unchanged = corpus.cases.find(
		(entry) => entry.basis === "unchanged-numbering",
	);
	if (!unchanged) throw new Error("Missing unchanged numbering.");
	const incompatible = structuredClone({ ...corpus, cases: [unchanged] });
	const proof = first(incompatible.cases).numberingEvidence;
	if (!proof) throw new Error("Missing numbering proof.");
	proof.providerLocalNumbers = [999];
	expect(() => validateNumberingCorpus(incompatible)).toThrow(
		"Unverified unchanged numbering",
	);
});
