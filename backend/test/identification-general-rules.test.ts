import { expect, test } from "vitest";
import {
	automaticBlockers,
	automaticProposal,
} from "../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../src/modules/anime/identification/application/identification.js";
import {
	matchingTitle,
	normalizeTitle,
	titleEvidence,
} from "../src/modules/anime/identification/domain/title-evidence.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../src/modules/anime/identification/public.js";

const work = (titles: string[], id = "1"): WorkCandidate => ({
	titles,
	reference: { provider: "test", mediaType: "anime", id },
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
			canonicalRoot: "/library",
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
		canonicalRoot: result.source.canonicalRoot,
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
