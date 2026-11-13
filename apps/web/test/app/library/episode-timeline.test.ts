import { expect, test } from "vitest";
import {
	confirmedEpisodeCount,
	episodeTimeline,
} from "../../../src/features/anime/catalog/episode-timeline.js";
import type { MetadataAiringResponse } from "../../../src/shared/api/contracts.js";
import { animeFixture } from "../../fixtures/anime.js";

const now = 2_000_000;
const label = (number: number) => `Episode ${number}`;
function schedule(
	items: { episode: number; airingAt: number }[],
	stale = false,
): MetadataAiringResponse {
	return {
		snapshotId: "airing",
		fetchedAt: 1_000_000,
		stale,
		refreshing: false,
		refreshError: null,
		data: {
			items: items.map((item) => ({ ...item, id: String(item.episode) })),
			page: 1,
			perPage: 25,
			hasNextPage: false,
		},
	};
}

test("finished works expose all regular episodes while unknown broadcast progress exposes only playable files", () => {
	const detail = animeFixture();
	const aired = confirmedEpisodeCount(detail.metadata, [], now);
	expect(aired).toBe(3);
	expect(
		episodeTimeline({
			workId: "work",
			format: "TV",
			episodes: detail.episodes,
			aired,
			episodeLabel: label,
		}),
	).toHaveLength(3);
	detail.metadata.data.status = null;
	detail.metadata.data.nextAiringEpisode = null;
	const unknown = confirmedEpisodeCount(detail.metadata, [], now);
	expect(unknown).toBeNull();
	expect(
		episodeTimeline({
			workId: "work",
			format: "TV",
			episodes: detail.episodes,
			aired: unknown,
			episodeLabel: label,
		}).map((episode) => episode.number),
	).toEqual(["1"]);
});

test("unknown totals use the confirmed aired range without inventing future placeholders", () => {
	const metadata = animeFixture().metadata;
	metadata.stale = false;
	metadata.fetchedAt = now;
	metadata.data.status = "RELEASING";
	metadata.data.episodeCount = null;
	metadata.data.nextAiringEpisode = { episode: 8, airingAt: now / 1000 + 100 };
	const aired = confirmedEpisodeCount(metadata, [], now);
	expect(aired).toBe(7);
	expect(
		episodeTimeline({
			workId: "remote",
			format: "TV",
			episodes: [],
			aired,
			episodeLabel: label,
		}).map((episode) => episode.number),
	).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
});

test("fresh future schedules constrain empty slots but never hide a playable local episode", () => {
	const detail = animeFixture();
	const aired = confirmedEpisodeCount(
		detail.metadata,
		[schedule([{ episode: 1, airingAt: now / 1000 + 100 }])],
		now,
	);
	expect(aired).toBe(0);
	expect(
		episodeTimeline({
			workId: "work",
			format: "TV",
			episodes: detail.episodes,
			aired,
			episodeLabel: label,
		}).map((episode) => episode.number),
	).toEqual(["1"]);
});

test("stale metadata and schedule clocks do not advance an episode when its old planned airtime passes", () => {
	const metadata = animeFixture().metadata;
	metadata.data.status = "RELEASING";
	metadata.data.episodeCount = null;
	metadata.data.nextAiringEpisode = { episode: 8, airingAt: 1500 };
	expect(confirmedEpisodeCount(metadata, [], now)).toBe(7);
	metadata.stale = false;
	metadata.fetchedAt = 1_600_000;
	expect(confirmedEpisodeCount(metadata, [], now)).toBe(8);
	metadata.data.nextAiringEpisode = null;
	expect(
		confirmedEpisodeCount(
			metadata,
			[schedule([{ episode: 8, airingAt: 1500 }], true)],
			now,
		),
	).toBeNull();
	expect(
		confirmedEpisodeCount(
			metadata,
			[schedule([{ episode: 7, airingAt: 500 }], true)],
			now,
		),
	).toBe(7);
});

test("not-yet-released works have no empty rows and playable specials remain sorted", () => {
	const detail = animeFixture();
	detail.metadata.data.status = "NOT_YET_RELEASED";
	const local = detail.episodes[0];
	if (!local) throw new Error("Missing fixture");
	const special = {
		...local,
		id: "special",
		kind: "special" as const,
		number: "SP1",
	};
	const result = episodeTimeline({
		workId: "work",
		format: "TV",
		episodes: [special, ...detail.episodes],
		aired: confirmedEpisodeCount(detail.metadata, [], now),
		episodeLabel: label,
	});
	expect(result.map((episode) => episode.id)).toEqual(["ep-1", "special"]);
});
