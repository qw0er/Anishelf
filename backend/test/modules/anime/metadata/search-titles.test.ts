import { expect, test } from "vitest";
import type { WorkDetails } from "../../../../src/modules/anime/external-works/metadata/public.js";
import { acquisitionSearchTitles } from "../../../../src/modules/anime/release-assessment/search-titles.js";

test("selects romaji, English, native and Chinese rather than the first four aliases", () => {
	const titles: WorkDetails["titles"] = [
		...["Generic A", "Generic B", "Generic C", "Generic D"].map((value) => ({
			value,
			kind: "alias" as const,
			language: null,
		})),
		{ value: "葬送のフリーレン", kind: "native", language: null },
		{ value: "葬送的芙莉蓮", kind: "alias", language: "zh-Hant" },
		{ value: "Frieren: Beyond Journey's End", kind: "english", language: "en" },
		{ value: "Sousou no Frieren", kind: "romaji", language: null },
		{ value: "葬送的芙莉莲", kind: "alias", language: "zh-Hans" },
	];
	expect(acquisitionSearchTitles(titles)).toEqual([
		"Sousou no Frieren",
		"Frieren: Beyond Journey's End",
		"葬送のフリーレン",
		"葬送的芙莉莲",
	]);
});
test("verified supplemental roles participate without becoming primary display names", () => {
	expect(
		acquisitionSearchTitles([
			{ value: "原名", kind: "native", language: null },
			{ value: "Romaji", kind: "alias", searchKind: "romaji", language: null },
			{
				value: "English",
				kind: "alias",
				searchKind: "english",
				language: null,
			},
			{ value: "中文名", kind: "alias", language: "zh-Hans" },
		]),
	).toEqual(["Romaji", "English", "原名", "中文名"]);
});
test("deduplicates equivalent queries, skips missing categories and rejects invalid names", () => {
	expect(
		acquisitionSearchTitles([
			{ value: " Ｆｒｉｅｒｅｎ ", kind: "romaji", language: null },
			{ value: "frieren", kind: "english", language: "en" },
			{ value: "Bad\nTitle", kind: "native", language: null },
			{ value: "unlabelled alias", kind: "alias", language: null },
			{ value: "   ", kind: "alias", language: "zh-Hans" },
		]),
	).toEqual(["Frieren"]);
});
