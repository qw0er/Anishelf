import { expect, test } from "vitest";
import {
	episodeViewing,
	episodeViewingCounts,
} from "../../../src/features/anime/tracking/episode-viewing.js";
import { PlaybackEvidence } from "../../../src/features/playback/player/evidence.js";

test("normal time excludes jumps and long gaps, resets on interruption, and uses wall time at double speed", () => {
	const evidence = new PlaybackEvidence();
	evidence.sample(90000, 1, 1000);
	evidence.sample(91000, 1, 2000);
	expect(evidence.normalPlayedMs).toBe(1000);
	evidence.sample(150000, 1, 3000);
	expect(evidence.normalPlayedMs).toBe(1000);
	evidence.reset();
	evidence.sample(150000, 2, 4000);
	evidence.sample(152000, 2, 5000);
	expect(evidence.normalPlayedMs).toBe(2000);
	evidence.reset();
	evidence.sample(154000, 2, 7000);
	evidence.sample(180000, 2, 20000);
	expect(evidence.normalPlayedMs).toBe(2000);
});

test("AniList indicators use cumulative targets and count available unwatched episodes once per episode", () => {
	const episodes = [
		{
			kind: "regular",
			number: "1",
			versions: [{ available: true }, { available: true }],
		},
		{
			kind: "regular",
			number: "2",
			versions: [{ available: true }, { available: true }],
		},
		{ kind: "regular", number: "3", versions: [{ available: false }] },
		{ kind: "special", number: "1", versions: [{ available: true }] },
		{ kind: "regular", number: "1.5", versions: [{ available: true }] },
	];
	expect(episodes.map((e) => episodeViewing(e, 1))).toEqual([
		"watched",
		"unwatched",
		"unwatched",
		"unknown",
		"unknown",
	]);
	expect(episodeViewingCounts(episodes, 1)).toEqual({
		watched: 1,
		availableUnwatched: 1,
	});
	expect(episodeViewingCounts(episodes, null)).toEqual({
		watched: 0,
		availableUnwatched: 0,
	});
	expect(episodeViewing({ kind: "movie", number: "1", versions: [] }, 1)).toBe(
		"watched",
	);
});
