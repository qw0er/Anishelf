import { expect, test } from "vitest";
import { animeNameParser } from "../src/anitomy-adapter.ts";
import {
	AnitomyIdentificationParser,
	proposeMapping,
	titleEvidence,
	type WorkCandidate,
} from "../src/index.ts";

const parser = new AnitomyIdentificationParser();
const sourcePath = (relativePath: string) => {
	const ancestors = relativePath.split("/");
	const filename = ancestors.pop() ?? "";
	return { relativePath, ancestors, filename };
};
const extract = (path: string) => parser.extract([sourcePath(path)])[0];
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
test("parses each directory as a separate sibling group and preserves input order", () => {
	const first = "Ocean Season 2/Ocean - 13.mkv";
	const second = "Other Show/Other - 01.mkv";
	const third = "Ocean Season 2/Ocean - 14.mkv";
	const siblings = parser.extract([first, third].map(sourcePath));
	expect(parser.extract([first, second, third].map(sourcePath))).toEqual([
		siblings[0],
		extract(second),
		siblings[1],
	]);
});
test("maps a bounded leaf range, ignoring the ancestor batch range", () => {
	const evidence = extract("Show [01-12]/Show - 01-02.mkv");
	if (!evidence) throw new Error("Missing evidence");
	expect(evidence.numbering).toBe("range");
	expect(
		proposeMapping(evidence, work).targets.map((target) => target.number),
	).toEqual(["1", "2"]);
});
test("a release year before the episode is not a descending range", () => {
	const evidence = extract("Show 2023 - 01 [1920x1080].mkv");
	if (!evidence) throw new Error("Missing evidence");
	expect(evidence.numbering).toBe("single");
	expect(proposeMapping(evidence, work).targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
});
test.each(["Show - 29 (S02E01).mkv", "Show - 29 (s02e01).mkv"])(
	"selects explicit local numbering and preserves raw numbering: %s",
	(name) => {
		const evidence = extract(name);
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
		const evidence = extract(name);
		if (!evidence) throw new Error("Missing evidence");
		expect(proposeMapping(evidence, work).targets).toEqual([]);
	},
);
test("episode zero supplies a manual special suggestion without automatic regular mapping", () => {
	const evidence = extract("Show - 00.mkv");
	if (!evidence) throw new Error("Missing evidence");
	const mapping = proposeMapping(evidence, work);
	expect(mapping.targets).toEqual([{ kind: "special", number: "0" }]);
	expect(mapping.unresolved).toHaveLength(1);
});
test("extracts bilingual titles and only repeated bracket labels as fallbacks", () => {
	expect(extract("迷宫饭 Dungeon Meshi - 01.mkv")?.titles).toEqual(
		expect.arrayContaining(["迷宫饭", "Dungeon Meshi"]),
	);
	expect(
		extract("[Mushoku Tensei][12-23]/[Mushoku Tensei][15].mp4")?.titles,
	).toContain("Mushoku Tensei");
	expect(extract("[SomeGroup][15].mp4")?.titles).not.toContain("SomeGroup");
});
test.each([
	"Menu 1.mkv",
	"NC Opening 2 Version 1.mkv",
	"NC Ending 1.mkv",
	"[Group][Show S2][menu][03].mkv",
	"[Group]Show The Movie[Trailer2][1080p].mp4",
])("classifies ancillary leaf %s", (name) => {
	expect(extract(`Show S2/Extra/${name}`)?.contentKind).toBe("ancillary");
});
test("menu directories classify resources without treating every extras file as ancillary", () => {
	expect(extract("Show/menu/01.mkv")?.contentKind).toBe("ancillary");
	expect(extract("Show/extras/Show - 01.mkv")?.contentKind).toBe("regular");
	expect(extract("The Menu - 01.mkv")?.contentKind).toBe("regular");
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
	const evidence = extract(path);
	expect(evidence?.seasons.map(Number)).toEqual(expect.arrayContaining([1, 2]));
	expect(evidence?.inputs[0]?.elements).toEqual(
		animeNameParser.parse("Sousou no Frieren S01E01.mkv"),
	);
	expect(evidence?.inputs[1]?.elements).toEqual(
		animeNameParser.parse("葬送的芙莉莲 第二季"),
	);
});
test("cleans language residue only with an explicit dubbed audio tag", () => {
	expect(extract("SPYxFAMILY Chinese Dubbed - 01.mp4")?.titles).toContain(
		"SPYxFAMILY",
	);
	expect(
		animeNameParser.adapt("Johnny English", [
			{ kind: "title", value: "Johnny English", position: 0 },
		]),
	).toEqual([{ kind: "title", value: "Johnny English", position: 0 }]);
});

test.each([
	"86",
	"3-gatsu no Lion",
	"Mob Psycho 100",
	"Johnny English",
	"[Oshi no Ko]",
	"Example 2022",
])(
	"preserves the complete metadata title despite filename tokenization: %s",
	(name) => {
		expect(animeNameParser.title(name).title).toBe(name);
		expect(animeNameParser.title(name).seasons).toEqual([]);
	},
);

test.each(["Example Season II", "Example 2nd Season", "Example (Season 2)"])(
	"uses library season parsing for metadata title %s",
	(name) => {
		expect(animeNameParser.title(name)).toMatchObject({
			title: "Example",
			seasons: ["2"],
		});
	},
);

test("preserves subtitles and Unicode positions while retaining conflicting metadata ordinals", () => {
	expect(animeNameParser.title("🌟 Example Season II: Arc")).toMatchObject({
		title: "🌟 Example : Arc",
		seasons: ["2"],
	});
	expect(animeNameParser.title("Example Season 2 Season 3").seasons).toEqual([
		"2",
		"3",
	]);
});

test("retains a library-parsed trailing number as ambiguous metadata title evidence", () => {
	expect(animeNameParser.title("Cyberpunk: Edgerunners 2")).toMatchObject({
		title: "Cyberpunk: Edgerunners 2",
		seasons: [],
		numberedTitle: { title: "Cyberpunk: Edgerunners", number: "2" },
	});
	expect(animeNameParser.title("86").numberedTitle).toBeNull();
});
