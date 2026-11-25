import { expect, test, vi } from "vitest";
import {
	evaluateReleaseCorpus,
	frierenSeasonPackFixture,
	loadReleaseCorpus,
	validateReleaseCorpus,
} from "../../../support/anime-release-corpus.js";

const corpus = await loadReleaseCorpus();
const frieren = frierenSeasonPackFixture(corpus);
function first<T>(items: readonly T[]): T {
	const item = items[0];
	if (!item) throw new Error("Missing release fixture.");
	return item;
}
test("retains 38 authentic titles separately from eight authored boundaries", () => {
	expect(
		corpus.cases.filter((entry) => entry.kind === "authentic"),
	).toHaveLength(38);
	expect(
		corpus.cases.filter((entry) => entry.kind === "synthetic"),
	).toHaveLength(8);
	expect(
		corpus.cases.filter((entry) => entry.provenance.site === "dmhy"),
	).toHaveLength(5);
	expect(
		corpus.cases.filter((entry) => entry.provenance.site === "nyaa"),
	).toHaveLength(33);
});
test("existing synthetic subscription boundaries pass the production assessor offline", () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Offline test."));
	try {
		const report = evaluateReleaseCorpus({
			...corpus,
			cases: corpus.cases.filter((entry) => entry.kind === "synthetic"),
		});
		expect(report.summary).toMatchObject({
			total: 8,
			passed: 8,
			runtimeErrors: 0,
		});
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		fetch.mockRestore();
	}
});
test("every real publication receives attribute evaluation even if it is ineligible", () => {
	const report = evaluateReleaseCorpus(corpus);
	expect(report.summary).toMatchObject({ total: 46, runtimeErrors: 0 });
	expect(report.fields["attributes.subtitleLanguages"]?.total).toBe(40);
	expect(report.fields.eligible?.total).toBe(38);
	expect(report.fields.episode?.total).toBe(3);
	for (const row of report.rows) expect(row.actual?.attributes).toBeDefined();
});
test.each([
	frieren.title,
	"[G] Sousou no Frieren S2 - 01-10 [1080p]",
	"[G] Sousou no Frieren S2 - 01–10 [1080p]",
	"[G] Sousou no Frieren Season 2 - 01–10 [1080p]",
	"[G] Sousou no Frieren S02E01-E10 [1080p]",
	"[G] Sousou no Frieren S2 - 01~10 [1080p]",
	"[G] Sousou no Frieren S2 [1080p]",
	"[G] Sousou no Frieren S2 合集 [1080p]",
])("shortlists %s without claiming a single episode", (title) => {
	expect(frieren.assessReleaseTitle(title, frieren.target)).toMatchObject({
		inspectionCandidate: true,
		eligible: false,
		episode: null,
		reasons: ["pack_requires_inspection"],
	});
});
test("END allows a confirmed single finale and an unrelated pack is not shortlisted", () => {
	expect(
		frieren.assessReleaseTitle(
			"[G] Sousou no Frieren Season 2 - E10 END [1080p]",
			frieren.target,
		),
	).toMatchObject({ inspectionCandidate: true, eligible: true, episode: 10 });
	for (const title of [
		"[G] Other Anime S2 [Batch]",
		"[G] Sousou no Frieren S3 [Batch]",
		"[G] Sousou no Frieren S2 OVA - 01",
	])
		expect(
			frieren.assessReleaseTitle(title, frieren.target),
			title,
		).toMatchObject({ inspectionCandidate: false, eligible: false });
});
test("a numbered work title and a pack word within a group name leave a single eligible", () => {
	const target = {
		...frieren.target,
		work: {
			...frieren.target.work,
			titles: ["86"],
			titleVariants: [
				{ value: "86", kind: "primary" as const, language: null },
			],
			season: null,
		},
	};
	expect(
		frieren.assessReleaseTitle("[合集字幕组] 86 - 03 [1080p]", target),
	).toMatchObject({ inspectionCandidate: true, eligible: true, episode: 3 });
});
test("ineligible publication attributes still contribute failures", () => {
	const original = first(corpus.cases);
	const entry = {
		...original,
		expected: { eligible: false, attributes: { subtitleLanguages: ["en"] } },
	};
	const report = evaluateReleaseCorpus({ ...corpus, cases: [entry] }, () => ({
		eligible: false,
		inspectionCandidate: false,
		episode: null,
		reasons: ["episode_unconfirmed"],
		version: "controlled",
	}));
	expect(report.rows[0]?.failures).toEqual(["attributes.subtitleLanguages"]);
	expect(report.fields["attributes.subtitleLanguages"]).toEqual({
		total: 1,
		correct: 0,
	});
});
test("expectations never change the supplied subscription target or title", () => {
	const input = structuredClone({
		...corpus,
		cases: [first(corpus.cases.filter((entry) => entry.id === "rule-single"))],
	});
	const run = vi.fn(() => ({
		eligible: true,
		inspectionCandidate: true,
		episode: 3,
		reasons: [],
		version: "controlled",
	}));
	evaluateReleaseCorpus(input, run);
	first(input.cases).expected.eligible = false;
	const report = evaluateReleaseCorpus(input, run);
	expect(run.mock.calls[0]).toEqual(run.mock.calls[1]);
	expect(report.rows[0]?.failures).toContain("eligible");
});
test("unknown work identity does not cause an arbitrary assessment target to be selected", () => {
	const entry = first(corpus.cases.filter((entry) => entry.targetId === null));
	const run = vi.fn();
	evaluateReleaseCorpus({ ...corpus, cases: [entry] }, run);
	expect(run).not.toHaveBeenCalled();
});
test("runtime failures remain in every labelled denominator", () => {
	const report = evaluateReleaseCorpus(
		{ ...corpus, cases: [first(corpus.cases)] },
		() => {
			throw new Error("Assessment failed.");
		},
	);
	expect(report.summary).toMatchObject({
		total: 1,
		failed: 1,
		runtimeErrors: 1,
	});
	expect(report.fields.eligible).toEqual({ total: 1, correct: 0 });
});
test("rejects missing targets, provenance and vacuous labels", () => {
	const entry = first(corpus.cases);
	expect(() =>
		validateReleaseCorpus({
			...corpus,
			cases: [{ ...entry, targetId: "unknown" }],
		}),
	).toThrow("Missing release target");
	expect(() =>
		validateReleaseCorpus({ ...corpus, cases: [{ ...entry, targetId: null }] }),
	).toThrow("known target");
	expect(() =>
		validateReleaseCorpus({
			...corpus,
			cases: [{ ...entry, provenance: { ...entry.provenance, url: null } }],
		}),
	).toThrow("provenance");
	expect(() =>
		validateReleaseCorpus({
			...corpus,
			cases: [{ ...entry, expected: { attributes: {} } }],
		}),
	).toThrow("expectations");
});
