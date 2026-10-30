import { expect, test } from "vitest";
import { automaticProposal } from "../../../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../../../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../../../../src/modules/anime/identification/application/identification.js";
import { titleEvidence } from "../../../../src/modules/anime/identification/domain/title-evidence.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../../../../src/modules/anime/identification/public.js";

const candidate = (id: string, titles: string[]): WorkCandidate => ({
	reference: { id },
	snapshotId: "test",
	titles,
	year: null,
	format: "TV",
	episodeCount: 12,
	season: null,
	part: null,
});
async function identify(path: string, works: WorkCandidate[]) {
	const queries: string[] = [];
	const engine = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: {
			search: async (query) => {
				queries.push(query);
				return works;
			},
		},
	});
	const [result] = await engine.identify([
		{
			scopeId: "/media",
			fileId: path,
			relativePath: path,
			sourceVersion: "1",
		},
	]);
	if (!result) throw new Error("Missing result");
	// Admission only reads these recognition fields and current review state.
	const record = {
		...result,
		decision: "pending",
		available: true,
	} as unknown as ReviewRecord;
	return { result, admitted: automaticProposal(record), queries };
}
test.each([
	"Example S2",
	"Example Season 2",
	"Example 2nd Season",
	"Example 第2期",
	"Example シーズン２",
])("extracts explicit candidate season from %s", (title) => {
	expect(titleEvidence(title).seasons).toEqual(["2"]);
});
test("first-season files with exact titles and valid episodes are admitted", async () => {
	const { admitted } = await identify("Ping Pong the Animation - S01E04.mkv", [
		candidate("1", ["Ping Pong THE ANIMATION"]),
	]);
	expect(admitted?.mapping.targets).toEqual([{ kind: "regular", number: "4" }]);
});
test("Chinese ancestor and leaf season contradictions block admission", async () => {
	const { admitted, result } = await identify(
		"Example 第二季/Example S01E01.mkv",
		[candidate("1", ["Example"]), candidate("2", ["Example Season 2"])],
	);
	expect(admitted).toBeNull();
	expect(result.proposals[0]?.candidate.conflicts).toContain(
		"Source series season evidence is contradictory.",
	);
});
test("explicit movie leaf beats a broad TV ancestor", async () => {
	const { admitted } = await identify(
		"Violet Evergarden/Violet Evergarden The Movie.mp4",
		[
			candidate("1", ["Violet Evergarden"]),
			{
				...candidate("2", ["Violet Evergarden The Movie"]),
				format: "MOVIE",
				episodeCount: 1,
			},
		],
	);
	expect(admitted?.candidate.work.reference.id).toBe("2");
	expect(admitted?.mapping.targets).toEqual([
		{ kind: "movie", number: "whole" },
	]);
});
test("explicit second-season titles beat a shared first-season alias", async () => {
	const { admitted, queries } = await identify("Example S2 - 09.mkv", [
		candidate("1", ["Example"]),
		candidate("2", ["Example 2nd Season"]),
	]);
	expect(admitted?.candidate.work.reference.id).toBe("2");
	expect(queries).toContain("Example Season 2");
});
test("complete Japanese directory title corroborates Clevatess II and breaks the shared-title tie", async () => {
	const { admitted, result } = await identify(
		"クレバテスⅡ-魔獣の王と偽りの勇者伝承-/[ASW] Clevatess S2 - 09 [1080p HEVC][9E9144F0].mkv",
		[
			candidate("1", [
				"Clevatess",
				"Clevatess: Majuu no Ou to Akago to Kabane no Yuusha",
			]),
			candidate("2", [
				"Clevatess",
				"Clevatess II: Majuu no Ou to Itsuwari no Yuusha Denshou",
				"クレバテスⅡ-魔獣の王と偽りの勇者伝承-",
			]),
		],
	);
	expect(admitted?.candidate.work.reference.id).toBe("2");
	expect(result.proposals[0]?.candidate.score).toBeGreaterThanOrEqual(
		(result.proposals[1]?.candidate.score ?? 0) + 10,
	);
});
test("bare Roman numerals do not verify a season from a base-title match", async () => {
	const { admitted } = await identify("Lupin S3 - 01.mkv", [
		candidate("1", ["Lupin", "Lupin III"]),
	]);
	expect(admitted).toBeNull();
});
test("conflicting source seasons and conflicting candidate aliases remain reviewable", async () => {
	expect(
		(
			await identify("Example Season 1/Example S2 - 01.mkv", [
				candidate("1", ["Example Season 2"]),
			])
		).admitted,
	).toBeNull();
	expect(
		(
			await identify("Example S2 - 01.mkv", [
				candidate("1", ["Example Season 2", "Example Season 3"]),
			])
		).admitted,
	).toBeNull();
});
test("unknown later seasons, part hints and invalid numbering remain pending", async () => {
	expect(
		(await identify("Example S2 - 01.mkv", [candidate("1", ["Example"])]))
			.admitted,
	).toBeNull();
	expect(
		(await identify("Example S01E13.mkv", [candidate("1", ["Example"])]))
			.admitted,
	).toBeNull();
	const part = candidate("1", ["Example"]);
	part.part = "1";
	expect((await identify("Example S2 - 01.mkv", [part])).admitted).toBeNull();
});

test("explicit season contradictions and tied seasons are not admitted", async () => {
	expect(
		(
			await identify("Example S01E01.mkv", [
				candidate("1", ["Example Season 2"]),
			])
		).admitted,
	).toBeNull();
	expect(
		(
			await identify("Example S2 - 01.mkv", [
				candidate("1", ["Example Season 2"]),
				candidate("2", ["Example 2nd Season"]),
			])
		).admitted,
	).toBeNull();
});

test("a base title without source season evidence cannot admit a numbered sequel", async () => {
	expect(
		(await identify("Example - 01.mkv", [candidate("1", ["Example Season 2"])]))
			.admitted,
	).toBeNull();
});

test("Japanese second-season directory does not boost the first season after ordinal stripping", async () => {
	const { admitted, result } = await identify(
		"正反対な君と僕 第2期/[DKB] Seihantai na Kimi to Boku - S02E12 [1080p][HEVC x265 10bit][Multi-Subs] [E8379898].mkv",
		[
			candidate("1", ["Seihantai na Kimi to Boku", "正反対な君と僕"]),
			candidate("2", [
				"Seihantai na Kimi to Boku 2nd Season",
				"正反対な君と僕 第2期",
			]),
		],
	);
	expect(admitted?.candidate.work.reference.id).toBe("2");
	expect(result.proposals[0]?.candidate.score).toBeGreaterThanOrEqual(
		(result.proposals[1]?.candidate.score ?? 0) + 10,
	);
});
test("a full arc title identifies JoJo without inventing a provider season ordinal", async () => {
	const { admitted } = await identify(
		"JoJo no Kimyou na Bouken Steel Ball Run - 1st STAGE/[Feibanyama] JoJos Bizarre Adventure S06E01 [NF WebRip 1080p H265 Veryslow AAC Multi-Audio Multi-Subs].mkv",
		[candidate("1", ["JoJo no Kimyou na Bouken: Steel Ball Run - 1st STAGE"])],
	);
	expect(admitted?.candidate.work.reference.id).toBe("1");
	expect(admitted?.mapping.targets).toEqual([{ kind: "regular", number: "1" }]);
});

test("complete context does not override explicit candidate season conflicts or invalid episode counts", async () => {
	const work = candidate("1", ["Example: Arc", "Example Season 3"]);
	expect(
		(await identify("Example Arc/Example S2 - 01.mkv", [work])).admitted,
	).toBeNull();
	expect(
		(
			await identify("Example Arc/Example S2 - 13.mkv", [
				candidate("1", ["Example: Arc"]),
			])
		).admitted,
	).toBeNull();
});
