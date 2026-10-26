import { expect, test } from "vitest";
import { animeNameParser } from "../src/modules/anime/identification/anitomy-adapter.js";
import { proposeMapping } from "../src/modules/anime/identification/domain/mapping.js";
import { titleEvidence } from "../src/modules/anime/identification/domain/title-evidence.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../src/modules/anime/identification/public.js";

const parser = new AnitomyIdentificationParser();
const work: WorkCandidate = {
	reference: { id: "1" },
	snapshotId: "test",
	titles: ["Show"],
	year: null,
	format: "TV",
	episodeCount: 12,
	season: "2",
	part: null,
};
test("maps a bounded leaf range, ignoring the ancestor batch range", () => {
	const evidence = parser.extract(["Show [01-12]/Show - 01-02.mkv"])[0];
	if (!evidence) throw new Error("Missing evidence");
	expect(evidence.numbering).toBe("range");
	expect(
		proposeMapping(evidence, work).targets.map((target) => target.number),
	).toEqual(["1", "2"]);
});
test("a release year before the episode is not a descending range", () => {
	const evidence = parser.extract(["Show 2023 - 01 [1920x1080].mkv"])[0];
	if (!evidence) throw new Error("Missing evidence");
	expect(evidence.numbering).toBe("single");
	expect(proposeMapping(evidence, work).targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
});
test.each(["Show - 29 (S02E01).mkv", "Show - 29 (s02e01).mkv"])(
	"selects explicit local numbering and preserves raw numbering: %s",
	(name) => {
		const evidence = parser.extract([name])[0];
		if (!evidence) throw new Error("Missing evidence");
		expect(evidence.rawEpisodes).toEqual(["29", "01"]);
		expect(evidence.selectedEpisodes).toEqual(["01"]);
		expect(proposeMapping(evidence, work).targets).toEqual([
			{ kind: "regular", number: "1" },
		]);
	},
);
test.each(["Show - 03-01.mkv", "Show - 01-999.mkv", "Show - 01 (S02E29).mkv"])(
	"keeps invalid or inconsistent numbers unresolved: %s",
	(name) => {
		const evidence = parser.extract([name])[0];
		if (!evidence) throw new Error("Missing evidence");
		expect(proposeMapping(evidence, work).targets).toEqual([]);
	},
);
test("episode zero supplies a manual special suggestion without automatic regular mapping", () => {
	const evidence = parser.extract(["Show - 00.mkv"])[0];
	if (!evidence) throw new Error("Missing evidence");
	const mapping = proposeMapping(evidence, work);
	expect(mapping.targets).toEqual([{ kind: "special", number: "0" }]);
	expect(mapping.unresolved).toHaveLength(1);
});
test("extracts bilingual titles and only repeated bracket labels as fallbacks", () => {
	expect(parser.extract(["迷宫饭 Dungeon Meshi - 01.mkv"])[0]?.titles).toEqual(
		expect.arrayContaining(["迷宫饭", "Dungeon Meshi"]),
	);
	expect(
		parser.extract(["[Mushoku Tensei][12-23]/[Mushoku Tensei][15].mp4"])[0]
			?.titles,
	).toContain("Mushoku Tensei");
	expect(parser.extract(["[SomeGroup][15].mp4"])[0]?.titles).not.toContain(
		"SomeGroup",
	);
});
test.each([
	"Menu 1.mkv",
	"NC Opening 2 Version 1.mkv",
	"NC Ending 1.mkv",
	"[Group][Show S2][menu][03].mkv",
	"[Group]Show The Movie[Trailer2][1080p].mp4",
])("classifies ancillary leaf %s", (name) => {
	expect(parser.extract([`Show S2/Extra/${name}`])[0]?.contentKind).toBe(
		"ancillary",
	);
});
test("menu directories classify resources without treating every extras file as ancillary", () => {
	expect(parser.extract(["Show/menu/01.mkv"])[0]?.contentKind).toBe(
		"ancillary",
	);
	expect(parser.extract(["Show/extras/Show - 01.mkv"])[0]?.contentKind).toBe(
		"regular",
	);
	expect(parser.extract(["The Menu - 01.mkv"])[0]?.contentKind).toBe("regular");
});
test.each([
	"Example 第二季",
	"Example 第２季",
	"Example 第2期",
	"Example シーズン２",
])("supplements explicit season in %s", (name) => {
	expect(titleEvidence(name).seasons).toContain("2");
	expect(titleEvidence(name).title).toBe("Example");
});
test("retains raw elements and both sides of conflicting season evidence", () => {
	const path = "葬送的芙莉莲 第二季/Sousou no Frieren S01E01.mkv";
	const evidence = parser.extract([path])[0];
	expect(evidence?.seasons.map(Number)).toEqual(expect.arrayContaining([1, 2]));
	expect(evidence?.inputs[0]?.elements).toEqual(
		animeNameParser.parse("Sousou no Frieren S01E01.mkv"),
	);
	expect(evidence?.inputs[1]?.elements).toEqual(
		animeNameParser.parse("葬送的芙莉莲 第二季"),
	);
});
test("cleans language residue only with an explicit dubbed audio tag", () => {
	expect(
		parser.extract(["SPYxFAMILY Chinese Dubbed - 01.mp4"])[0]?.titles,
	).toContain("SPYxFAMILY");
	expect(
		animeNameParser.adapt("Johnny English", [
			{ kind: "title", value: "Johnny English", position: 0 },
		]),
	).toEqual([{ kind: "title", value: "Johnny English", position: 0 }]);
});
