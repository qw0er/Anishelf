import { expect, test } from "vitest";
import { safeReview } from "../../../../src/modules/anime/anime-catalog/application/context.js";
import {
	automaticBlockers,
	automaticProposal,
} from "../../../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../../../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../../../../src/modules/anime/identification/application/identification.js";
import {
	matchingTitle,
	normalizeTitle,
	titleEvidence,
} from "../../../../src/modules/anime/identification/domain/title-evidence.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../../../../src/modules/anime/identification/public.js";

const work = (titles: string[], id = "1"): WorkCandidate => ({
	titles,
	reference: { id },
	snapshotId: "frozen",
	year: null,
	format: "TV",
	episodeCount: 12,
	season: null,
	part: null,
});
async function identify(paths: string[], works: WorkCandidate[]) {
	const app = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: { search: async () => works },
	});
	return app.identify(
		paths.map((relativePath) => ({
			relativePath,
			scopeId: "/library",
			fileId: relativePath,
			sourceVersion: "v1",
		})),
	);
}
const review = (result: Awaited<ReturnType<typeof identify>>[number]) =>
	({
		...result,
		id: result.source.fileId,
		sourceId: result.source.fileId,
		fileId: result.source.fileId,
		rootId: "test",
		sourceVersion: result.source.sourceVersion,
		relativePath: result.source.relativePath,
		scopeId: result.source.scopeId,
		revision: 1,
		reason: null,
		available: true,
		decision: "pending",
	}) satisfies ReviewRecord;

test.each(["Orbit;Gate0", "Ocean x Family", "Re:Turn Zero", "夢想的旅程"])(
	"canonical title variations preserve ranking/admission agreement: %s",
	async (title) => {
		const compact = title.replace(/[^\p{L}\p{N}]/gu, "");
		expect(matchingTitle(compact, title)).toBe(true);
		const results = await identify([`${compact} - 01.mkv`], [work([title])]);
		const result = results[0];
		if (!result) throw new Error("Missing result");
		expect(result.proposals[0]?.candidate.score).toBeGreaterThanOrEqual(70);
		expect(automaticProposal(review(result))).not.toBeNull();
	},
);
test("metadata title grammar preserves numbers and language words", () => {
	expect(titleEvidence("Johnny English").title).toBe("Johnny English");
	expect(titleEvidence("Orbit Gate 0").title).toBe("Orbit Gate 0");
	expect(matchingTitle("Orbit Gate", "Orbit Gate 0")).toBe(false);
	expect(matchingTitle("Ocean", "Ocean Season 2")).toBe(false);
	expect(normalizeTitle("夢想的旅程")).toBe(normalizeTitle("梦想的旅程"));
	expect(matchingTitle("OceanxJourney", "Ocean × Journey")).toBe(true);
});
test("explicit parts match and contradictions remain pending", async () => {
	const results = await identify(
		["Ocean Part 2 - 01.mkv"],
		[work(["Ocean Part 1"], "1"), work(["Ocean Part 2"], "2")],
	);
	const result = results[0];
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"2",
	);
});
test("shared unmarked aliases never imply season one", async () => {
	const [result] = await identify(
		["Ocean - 01.mkv"],
		[work(["Ocean"], "1"), work(["Ocean", "Ocean Season 2"], "2")],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticBlockers(review(result))).toContain(
		"Insufficient ranking margin.",
	);
});
test("an unmarked release cannot choose the base work over an explicitly numbered sequel", async () => {
	const [result] = await identify(
		["Ocean - 01.mkv"],
		[work(["Ocean"]), work(["Ocean Season 2"], "2")],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticBlockers(review(result))).toContain(
		"Insufficient ranking margin.",
	);
});
test("an exact complete numeric title outranks a similar but different work", async () => {
	const [result] = await identify(
		["Ocean II The Long Journey - 01.mkv"],
		[
			work(["Ocean II The Long Journey"]),
			work(["Ocean The Long Journey"], "2"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"1",
	);
});
test("consistent directory anchors convert continuous numbering and retain provenance", async () => {
	const results = await identify(
		[
			"Ocean Season 2/Ocean - 13 (S02E01).mkv",
			"Ocean Season 2/Ocean - 14 (S02E02).mkv",
			"Ocean Season 2/Ocean - 15.mkv",
		],
		[work(["Ocean Season 2"])],
	);
	const result = results[2];
	if (!result) throw new Error("Missing result");
	expect(result.evidence.rawEpisodes).toEqual(["15"]);
	expect(result.proposals[0]?.mapping.targets).toEqual([
		{ kind: "regular", number: "3" },
	]);
	expect(result.proposals[0]?.mapping.numbering).toMatchObject({
		offset: -12,
		source: "directory-anchors",
	});
	expect(automaticProposal(review(result))).not.toBeNull();
});
test.each([
	[
		"Ocean Season 2/Ocean - 13 (S02E01).mkv",
		"Ocean Season 2/Ocean - 15 (S02E02).mkv",
		"Ocean Season 2/Ocean - 16.mkv",
	],
	[
		"Ocean Season 2/Ocean - 13 (S02E01).mkv",
		"Other/Ocean Season 2 - 14 (S02E02).mkv",
		"Ocean Season 2/Ocean - 15.mkv",
	],
	[
		"Ocean Season 2/Ocean - 13 (S02E01).mkv",
		"Ocean Season 2/Ocean - 14 (S02E02).mkv",
		"Ocean Season 2/Other - 15.mkv",
	],
])(
	"conflicting, cross-directory or unrelated anchors cannot create mappings",
	async (...paths) => {
		const results = await identify(paths, [
			work(["Ocean Season 2"]),
			work(["Other Season 2"], "2"),
		]);
		expect(
			results[2]?.proposals.every((proposal) => !proposal.mapping.numbering),
		).toBe(true);
	},
);
test("zero is a manual special proposal; missing TV numbering has no target", async () => {
	const results = await identify(
		["Ocean Season 2/Ocean - 00.mkv", "Ocean Season 2/Ocean.mkv"],
		[work(["Ocean Season 2"])],
	);
	const zero = results[0];
	if (!zero) throw new Error("Missing zero");
	expect(zero.proposals[0]?.mapping.targets).toEqual([
		{ kind: "special", number: "0" },
	]);
	expect(automaticProposal(review(zero))).toBeNull();
	expect(results[1]?.proposals[0]?.mapping.targets).toEqual([]);
});
test("duplicate versions of a single anchor do not corroborate an offset", async () => {
	const results = await identify(
		[
			"Ocean Season 2/Ocean - 13 (S02E01) v1.mkv",
			"Ocean Season 2/Ocean - 13 (S02E01) v2.mkv",
			"Ocean Season 2/Ocean - 15.mkv",
		],
		[work(["Ocean Season 2"])],
	);
	expect(results[2]?.proposals[0]?.mapping.numbering).toBeUndefined();
});
test("a corroborated alternative within the local count still needs explicit numbering choice", async () => {
	const results = await identify(
		[
			"Ocean Season 2/Ocean - 13 (S02E01).mkv",
			"Ocean Season 2/Ocean - 14 (S02E02).mkv",
			"Ocean Season 2/Ocean - 15.mkv",
		],
		[{ ...work(["Ocean Season 2"]), episodeCount: 24 }],
	);
	const result = results[2];
	if (!result) throw new Error("Missing result");
	expect(result.proposals[0]?.mapping.numbering?.offset).toBe(-12);
	expect(automaticProposal(review(result))).toBeNull();
});

const provenanced = (primary: string, aliases: string[], id: string) => ({
	...work([primary, ...aliases], id),
	titleVariants: [
		{ value: primary, kind: "primary" as const, language: "en" },
		...aliases.map((value) => ({
			value,
			kind: "alias" as const,
			language: null,
		})),
	],
});

test("missing-season prior prefers a base work without manufacturing season evidence", async () => {
	const [result] = await identify(
		["Ocean - 03.mkv"],
		[
			provenanced("Ocean", [], "base"),
			provenanced("Ocean Season 2", ["Ocean"], "sequel"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(result.evidence.seasons).toEqual([]);
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"base",
	);
	expect(result.proposals[0]?.candidate.assumptions?.join(" ")).toContain(
		"source season remains unknown",
	);
});

test("alias-only ordinals remain weak and cannot settle a shared-title tie", async () => {
	const [result] = await identify(
		["Ocean - 03.mkv"],
		[
			provenanced("Ocean", [], "base"),
			provenanced("Ocean", ["Ocean Season 2", "Sea Journey"], "other"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))).toBeNull();
	expect(automaticBlockers(review(result))).toContain(
		"Insufficient ranking margin.",
	);
});

test("unresolved continuous numbering cannot justify a base-season preference", async () => {
	const [result] = await identify(
		["Ocean - 29.mkv"],
		[
			provenanced("Ocean", [], "base"),
			provenanced("Ocean Season 2", ["Ocean"], "sequel"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(
		result.proposals.every(
			(proposal) => !proposal.candidate.assumptions?.length,
		),
	).toBe(true);
	expect(automaticBlockers(review(result))).toContain(
		"Insufficient ranking margin.",
	);
});

test("explicit seasons override the missing-season prior", async () => {
	const [result] = await identify(
		["Ocean S02E03.mkv"],
		[
			provenanced("Ocean Season 1", ["Ocean"], "base"),
			provenanced("Ocean Season 2", ["Ocean"], "sequel"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"sequel",
	);
	expect(
		result.proposals.every(
			(proposal) => !proposal.candidate.assumptions?.length,
		),
	).toBe(true);
});

test("complete Roman sequel titles override the missing-season prior", async () => {
	const [result] = await identify(
		["Ocean II - 03.mkv"],
		[
			provenanced("Ocean", [], "base"),
			provenanced("Ocean II", ["Ocean"], "sequel"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"sequel",
	);
	expect(result.proposals[0]?.candidate.assumptions).toEqual([]);
});

test("filename identity outranks a distant directory's different work", async () => {
	const [result] = await identify(
		["Ocean/Archive/Other Journey - 03.mkv"],
		[
			provenanced("Ocean", [], "parent"),
			provenanced("Other Journey", [], "leaf"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(automaticProposal(review(result))?.candidate.work.reference.id).toBe(
		"leaf",
	);
	expect(result.evidence.titleSources).toContainEqual({
		title: "Ocean",
		mode: "ancestor",
		distance: 1,
	});
});

test("contradictory candidates do not compete, but unknown numbering remains plausible", async () => {
	const [result] = await identify(
		["Ocean - 03.mkv"],
		[work(["Ocean"], "valid")],
	);
	if (!result) throw new Error("Missing result");
	const record = review(result);
	const valid = record.proposals[0];
	if (!valid) throw new Error("Missing proposal");
	record.proposals = [
		{
			...valid,
			candidate: {
				...valid.candidate,
				score: valid.candidate.score + 1,
				identityConflicts: ["Series season differs."],
				conflicts: ["Series season differs."],
			},
		},
		valid,
	];
	expect(automaticProposal(record)).toBe(valid);
	record.proposals[0] = {
		...valid,
		candidate: {
			...valid.candidate,
			identityConflicts: [],
			conflicts: ["Numbering needs correction."],
		},
		mapping: { ...valid.mapping, unresolved: ["Offset unknown."] },
	};
	expect(automaticBlockers(record)).toContain("Insufficient ranking margin.");
	expect(automaticProposal(record)).toBeNull();
});

test("work identity survives pending numbering without admitting an association", async () => {
	const [result] = await identify(
		["Ocean - 29.mkv"],
		[provenanced("Ocean", [], "base")],
	);
	if (!result) throw new Error("Missing result");
	const record = review(result);
	const item = safeReview(record, true);
	expect(item.recognizedWork).toMatchObject({
		reference: { id: "base" },
		mappingStatus: "pending",
	});
	expect(item.associations).toEqual([]);
	expect(automaticProposal(record)).toBeNull();
	expect(safeReview(record, false).recognizedWork).toBeUndefined();
	expect(
		safeReview({ ...record, decision: "rejected" }, true).recognizedWork,
	).toBeUndefined();
	expect(
		safeReview({ ...record, decision: "confirmed" }, true).recognizedWork,
	).toBeUndefined();
});

test("inconsistent provider ordinals remain plausible alternatives rather than disappearing", async () => {
	const [result] = await identify(
		["Ocean - 03.mkv"],
		[
			provenanced("Ocean", [], "base"),
			provenanced("Ocean", ["Ocean Season 2", "Ocean Season 3"], "uncertain"),
		],
	);
	if (!result) throw new Error("Missing result");
	const uncertain = result.proposals.find(
		(proposal) => proposal.candidate.work.reference.id === "uncertain",
	);
	expect(uncertain?.candidate.identityConflicts).toEqual([]);
	expect(uncertain?.candidate.identityUnresolved).toContain(
		"Candidate series season evidence is contradictory.",
	);
	expect(automaticProposal(review(result))).toBeNull();
});

test("a different work in a distant directory cannot trigger a sequel penalty", async () => {
	const [result] = await identify(
		["Ocean/Archive/Other Journey - 03.mkv"],
		[
			provenanced("Ocean", [], "parent"),
			provenanced("Other Journey Season 2", ["Other Journey"], "leaf"),
		],
	);
	if (!result) throw new Error("Missing result");
	expect(
		result.proposals.find(
			(proposal) => proposal.candidate.work.reference.id === "leaf",
		)?.candidate.assumptions,
	).toEqual([]);
});
