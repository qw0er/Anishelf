import { expect, test } from "vitest";
import { nameCorrespondence } from "../../../../src/modules/anime/external-works/metadata/domain/name-correspondence.js";
import type { WorkDetails } from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";

function work(overrides: Partial<WorkDetails> = {}): WorkDetails {
	return {
		reference: { provider: "fixture", mediaType: "anime", id: "1" },
		titles: [
			{ value: "星巡りの旅", kind: "native", language: null },
			{ value: "Journey Among Stars", kind: "english", language: "en" },
		],
		unavailableFields: [],
		year: 2026,
		format: "TV",
		status: null,
		episodeCount: 12,
		startDate: { year: 2026, month: 10, day: 3 },
		endDate: null,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: null,
		bannerUrl: null,
		description: null,
		durationMinutes: null,
		country: null,
		source: null,
		genres: [],
		tags: [],
		studios: [],
		averageScore: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable",
		siteUrl: null,
		providerUpdatedAt: null,
		...overrides,
	};
}
const titles = (value: string): WorkDetails["titles"] => [
	{ value, kind: "native", language: null },
];
test.each([
	{ episodeCount: null },
	{ episodeCount: 24 },
	{ episodeCount: 120, format: "TV_SHORT" },
	{ startDate: { year: 2026, month: 10, day: 4 } },
	{ startDate: { year: 2026, month: 10, day: null } },
	{ startDate: null },
	{ startDate: { year: 2026, month: 4, day: 3 } },
	{ format: null },
] satisfies Partial<WorkDetails>[])(
	"missing or source-specific auxiliary facts retain corroborated correspondence: %j",
	(override) => {
		expect(nameCorrespondence(work(), work(override)).state).toBe("confirmed");
	},
);
test("one-day date disagreement can cross a calendar year", () => {
	expect(
		nameCorrespondence(
			work({ startDate: { year: 2026, month: 12, day: 31 } }),
			work({ startDate: { year: 2027, month: 1, day: 1 } }),
		).state,
	).toBe("confirmed");
});
test("large date differences require another independent name", () => {
	expect(
		nameCorrespondence(
			work({ titles: titles("Distinctive Journey") }),
			work({
				titles: titles("Distinctive Journey"),
				startDate: { year: 2026, month: 1, day: 1 },
			}),
		),
	).toMatchObject({
		state: "insufficient",
		reasons: ["large-date-disagreement"],
	});
});
test.each(["season", "part", "stage", "roman", "number", "pv", "segment"])(
	"explicit %s differences override generic shared names",
	(kind) => {
		const pairs: Record<string, [string, string]> = {
			season: ["Star Journey Season 2", "Star Journey Season 3"],
			part: ["Star Journey Part 1", "Star Journey Part 2"],
			stage: ["Star Journey 2nd & 3rd STAGE", "Star Journey 1st STAGE"],
			roman: ["Star Journey II", "Star Journey III"],
			number: ["Area 86", "Area 87"],
			pv: ["Star Journey", "Star Journey PV"],
			segment: ["星巡りの旅 前編", "星巡りの旅 後編"],
		};
		const pair = pairs[kind];
		if (!pair) throw new Error("Missing test pair");
		const a = work({
			titles: [
				...titles(pair[0]),
				{ value: "Generic Franchise", kind: "english", language: "en" },
			],
		});
		const b = work({
			titles: [
				...titles(pair[1]),
				{ value: "Generic Franchise", kind: "english", language: "en" },
			],
		});
		expect(nameCorrespondence(a, b).state).toBe("conflict");
	},
);
test("movie and TV remain incompatible even with identical names and dates", () => {
	expect(nameCorrespondence(work(), work({ format: "MOVIE" })).state).toBe(
		"conflict",
	);
});
test("TV versus ONA needs explicit matching scope and additional naming evidence", () => {
	expect(nameCorrespondence(work(), work({ format: "ONA" })).state).toBe(
		"insufficient",
	);
	const scoped = work({
		titles: [
			...titles("Star Journey Season 2"),
			{ value: "星巡りの旅 第2期", kind: "english", language: "en" },
		],
	});
	expect(
		nameCorrespondence(scoped, {
			...scoped,
			format: "ONA",
			startDate: null,
			year: null,
		}).state,
	).toBe("confirmed");
});
test("remakes in different years are explicit conflicts", () => {
	expect(
		nameCorrespondence(
			work(),
			work({ startDate: { year: 2020, month: 10, day: 3 } }),
		).state,
	).toBe("conflict");
});
test("word permutation alone is not a match", () => {
	expect(
		nameCorrespondence(
			work({ titles: titles("World Beyond The Star") }),
			work({ titles: titles("The Star Beyond World") }),
		).state,
	).toBe("insufficient");
});
test("ordinary aliases alone cannot establish correspondence", () => {
	expect(
		nameCorrespondence(
			work({
				titles: [
					...titles("Alpha"),
					{ value: "Shared Alias", kind: "alias", language: null },
				],
			}),
			work({
				titles: [
					...titles("Beta"),
					{ value: "Shared Alias", kind: "alias", language: null },
				],
			}),
		).state,
	).toBe("insufficient");
});
test("missing all corroborating facts cannot confirm a singleton shared title", () => {
	const unknown = work({
		titles: titles("A Unique Journey"),
		year: null,
		startDate: null,
		format: null,
		episodeCount: null,
	});
	expect(nameCorrespondence(unknown, unknown).state).toBe("insufficient");
});
test.each([
	{ year: 2026, month: 2, day: 30 },
	{ year: 2026, month: 13, day: 1 },
])("invalid dates are not treated as missing: %j", (startDate) => {
	expect(nameCorrespondence(work(), work({ startDate })).state).toBe(
		"insufficient",
	);
});
test("a descriptive arc suffix needs an explicit season and does not erase finale scope", () => {
	const original = work({ titles: titles("星巡りの旅 第3期") });
	expect(
		nameCorrespondence(
			original,
			work({ titles: titles("星巡りの旅 第3期【星雲篇】") }),
		).state,
	).toBe("confirmed");
	expect(
		nameCorrespondence(
			original,
			work({ titles: titles("星巡りの旅 第3期【完結篇】") }),
		).state,
	).toBe("conflict");
});

test("different explicit arc subtitles cannot collapse into the same season", () => {
	expect(
		nameCorrespondence(
			work({ titles: titles("星巡りの旅 第3期【星雲篇】") }),
			work({ titles: titles("星巡りの旅 第3期【銀河篇】") }),
		),
	).toMatchObject({ state: "conflict", reasons: ["arc-conflict"] });
});
