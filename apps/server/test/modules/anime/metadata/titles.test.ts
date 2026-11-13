import { expect, test } from "vitest";
import { MetadataTitles } from "../../../../src/modules/anime/external-works/metadata/application/titles.js";
import {
	type MetadataTitle,
	type TitleDisplayPreference,
	workTitle,
} from "../../../../src/modules/anime/external-works/metadata/domain/model.js";

const titles: MetadataTitle[] = [
	{ value: "  ", kind: "native", language: null },
	{ value: "Romaji", kind: "romaji", language: null },
	{ value: "Original", kind: "native", language: null },
	{ value: "中文", kind: "alias", language: "zh-Hans" },
	{ value: "繁體", kind: "alias", language: "zh-Hant" },
	{ value: "English", kind: "alias", searchKind: "english", language: "en" },
];
test.each([
	["native", "Original"],
	["chinese", "中文"],
	["english", "English"],
	["romaji", "Romaji"],
] as const)("selects %s without changing evidence", (preference, expected) => {
	const before = structuredClone(titles);
	expect(workTitle(titles, "id", preference)).toBe(expected);
	expect(titles).toEqual(before);
});
test("uses explicit Chinese language tags and preserves source order", () => {
	expect(
		workTitle(
			[{ value: "中文", kind: "alias", language: null }],
			"id",
			"chinese",
		),
	).toBe("中文");
	expect(
		workTitle(
			[
				{ value: "中文", kind: "alias", language: null },
				{ value: "Original", kind: "native", language: null },
			],
			"id",
			"chinese",
		),
	).toBe("Original");
	expect(
		workTitle(
			[{ value: "Chinese", kind: "alias", language: "ZH" }, ...titles],
			"id",
			"chinese",
		),
	).toBe("Chinese");
});
test("falls back through nonempty original, first available and supplied fallback", () => {
	expect(workTitle(titles.slice(0, 3), "id", "english")).toBe("Original");
	expect(workTitle(titles.slice(0, 2), "id", "english")).toBe("Romaji");
	expect(workTitle(titles.slice(0, 1), "id", "english")).toBe("id");
	expect(workTitle([], "id")).toBe("id");
});
test("retained snapshots change presentation without changing identity or evidence", () => {
	let preference: TitleDisplayPreference = "native";
	const presenter = new MetadataTitles(() => preference);
	const work = { reference: { id: "work" }, titles } as Parameters<
		typeof presenter.work
	>[0];
	const first = presenter.work(work);
	preference = "chinese";
	expect(presenter.work(work).displayTitle).toBe("中文");
	expect(first.displayTitle).toBe("Original");
	expect(work).not.toHaveProperty("displayTitle");
	expect(presenter.work(work).titles).toBe(titles);
});
