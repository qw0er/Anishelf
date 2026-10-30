import { expect, test } from "vitest";
import { mappingDefaults } from "../../../src/features/anime/review/mapping-defaults.js";
import { reviewFixture } from "../../fixtures/anime.js";

const reference = { id: "metadata-work-1" };
test("explicit local filename numbering is preferred to both raw numbers", () => {
	const item = reviewFixture();
	item.evidence.rawEpisodes = ["29", "01"];
	item.evidence.selectedEpisodes = ["01"];
	item.evidence.numbering = "single";
	expect(mappingDefaults(item, reference, "TV", 10)).toMatchObject({
		kind: "regular",
		numbers: "1",
		offset: 0,
	});
});
test("manual zero and unknown TV numbering do not become regular episode one", () => {
	const item = reviewFixture();
	item.evidence.rawEpisodes = ["00"];
	item.evidence.numbering = "single";
	expect(mappingDefaults(item, reference, "TV", 10)).toMatchObject({
		kind: "special",
		numbers: "0",
		label: "",
	});
	item.evidence.rawEpisodes = [];
	item.evidence.numbering = "unknown";
	expect(mappingDefaults(item, reference, "TV", 10).numbers).toBe("");
});
test("saved mappings default only for their project work", () => {
	const item = reviewFixture(true);
	const link = item.associations[0];
	if (!link) throw new Error("Missing association");
	link.number = "9";
	expect(mappingDefaults(item, reference, "TV", 12).numbers).toBe("9");
	expect(
		mappingDefaults(item, { ...reference, id: "2" }, "TV", 12).numbers,
	).not.toBe("9");
});
test("corroborated offset suggestions are applied exactly once by preview", () => {
	const item = reviewFixture();
	item.proposals = [
		{
			candidate: {
				work: {
					reference: { id: reference.id },
					snapshotId: "frozen",
					titles: ["Ocean Season 2"],
					year: null,
					format: "TV",
					episodeCount: 12,
					season: "2",
					part: null,
				},
				score: 85,
				conflicts: [],
				reasons: [],
				matcherVersion: "test",
			},
			mapping: {
				targets: [{ kind: "regular", number: "5" }],
				unresolved: [],
				reasons: [],
				numbering: {
					source: "directory-anchors",
					offset: -12,
					anchors: [
						{ fileId: "a", sourceVersion: "1" },
						{ fileId: "b", sourceVersion: "1" },
					],
				},
			},
		},
	];
	const defaults = mappingDefaults(item, reference, "TV", 12);
	expect(defaults).toMatchObject({ numbers: "17", offset: -12 });
	expect(Number(defaults.numbers) + defaults.offset).toBe(5);
});
