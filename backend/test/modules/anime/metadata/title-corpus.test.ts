import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const root = new URL("../../../fixtures/title-enrichment/", import.meta.url);
interface Snapshot {
	id: string;
	anilist: {
		sourceUrl: string;
		fetchedAt: string;
		responseSha256: string;
		data: {
			id: number;
			type: string;
			title: {
				native: string | null;
				romaji: string | null;
				english: string | null;
			};
		};
	};
	bangumiCandidates: {
		sourceUrl: string;
		fetchedAt: string;
		responseSha256: string;
		data: { id: number; type: number; name: string; name_cn: string };
	}[];
}
interface CorpusCase {
	id: string;
	snapshot: string;
	bangumiId: number;
	expected: "same-work" | "different-work" | "unresolved";
	tags: string[];
	rationale: string;
}
const corpus = JSON.parse(
	await readFile(new URL("cases.json", root), "utf8"),
) as { cases: CorpusCase[] };

test("the real-source corpus covers positive, hard-negative and reported cases beyond the reported works", () => {
	expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(
		corpus.cases.length,
	);
	expect(
		corpus.cases.filter((item) => item.expected === "same-work").length,
	).toBeGreaterThanOrEqual(30);
	expect(
		corpus.cases.filter((item) => item.expected === "different-work").length,
	).toBeGreaterThanOrEqual(15);
	const tags = new Set(corpus.cases.flatMap((item) => item.tags));
	for (const tag of [
		"reported-regression",
		"coverage-expansion",
		"movie",
		"sequel",
		"short-form",
		"date-disagreement",
		"missing-episode-count",
		"title-variation",
		"incomplete-date",
	])
		expect(tags.has(tag), tag).toBe(true);
});

test.each(corpus.cases)(
	"$id retains actual provider records and explicit expected correspondence",
	async (item) => {
		const snapshot = JSON.parse(
			await readFile(new URL(`snapshots/${item.snapshot}.json`, root), "utf8"),
		) as Snapshot;
		expect(snapshot.id).toBe(item.snapshot);
		expect(snapshot.anilist.sourceUrl).toBe(
			`https://anilist.co/anime/${snapshot.anilist.data.id}`,
		);
		expect(snapshot.anilist.data.type).toBe("ANIME");
		expect(snapshot.anilist.responseSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(Number.isNaN(Date.parse(snapshot.anilist.fetchedAt))).toBe(false);
		const candidate = snapshot.bangumiCandidates.find(
			(entry) => entry.data.id === item.bangumiId,
		);
		expect(candidate, `Missing Bangumi evidence for ${item.id}`).toBeDefined();
		expect(candidate?.sourceUrl).toBe(
			`https://bgm.tv/subject/${item.bangumiId}`,
		);
		expect(candidate?.responseSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(candidate?.data.name.trim()).not.toBe("");
		expect(item.rationale.length).toBeGreaterThan(20);
		expect(item.tags.length).toBeGreaterThan(0);
		if (item.expected === "same-work") expect(candidate?.data.type).toBe(2);
	},
);

test("franchise families stay in one evaluation split", () => {
	const splits = new Map<string, Set<string>>();
	for (const item of corpus.cases as (CorpusCase & {
		family: string;
		split: string;
	})[]) {
		const family = splits.get(item.family) ?? new Set<string>();
		family.add(item.split);
		splits.set(item.family, family);
	}
	expect([...splits.values()].every((family) => family.size === 1)).toBe(true);
});
