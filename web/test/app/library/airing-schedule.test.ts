import { expect, test } from "vitest";
import { airingSchedule } from "../../../src/features/anime/catalog/airing-schedule.js";
import type { MetadataAiringResponse } from "../../../src/shared/api/contracts.js";
import { animeFixture } from "../../fixtures/anime.js";

function page(
	episode: number,
	airingAt: number,
	fetchedAt: number,
	stale = false,
): MetadataAiringResponse {
	return {
		snapshotId: String(fetchedAt),
		fetchedAt,
		stale,
		refreshing: false,
		refreshError: null,
		data: {
			items: [{ id: `${episode}-${fetchedAt}`, episode, airingAt }],
			page: 1,
			perPage: 25,
			hasNextPage: false,
		},
	};
}

test("rescheduled broadcasts use the newest snapshot and deduplicate overlapping pages and next metadata", () => {
	const metadata = animeFixture().metadata;
	metadata.fetchedAt = 1000;
	metadata.stale = false;
	metadata.data.nextAiringEpisode = { episode: 10, airingAt: 20 };
	const result = airingSchedule(
		[page(10, 30, 2000), page(10, 20, 1000)],
		metadata,
		3000,
	);
	expect(result.plans).toHaveLength(1);
	expect(result.plans[0]?.airingAt).toBe(30);
});

test("fresh evidence wins snapshot ties and stale history still confirms its past", () => {
	const result = airingSchedule(
		[page(2, 30, 2000), page(2, 30, 2000, true), page(1, 1, 2000, true)],
		null,
		3000,
	);
	expect(result.plans[0]?.stale).toBe(false);
	expect(result.history[0]).toMatchObject({
		episode: 1,
		status: "aired",
		stale: true,
	});
});

test("announced future broadcasts precede elapsed plans awaiting confirmation", () => {
	const result = airingSchedule(
		[page(1, 2, 1000), page(2, 20, 1000)],
		null,
		3000,
	);
	expect(result.plans.map((item) => [item.episode, item.status])).toEqual([
		[2, "scheduled"],
		[1, "unconfirmed"],
	]);
	expect(result.history).toEqual([]);
});

test("a known episode total without announced dates does not invent a future schedule", () => {
	const metadata = animeFixture().metadata;
	metadata.data.status = "RELEASING";
	metadata.data.episodeCount = 12;
	metadata.data.nextAiringEpisode = null;
	expect(airingSchedule([], metadata, 3000)).toEqual({
		plans: [],
		history: [],
	});
});
