// @vitest-environment happy-dom

import { expect, test } from "vitest";
import {
	episodeViewing,
	episodeViewingCounts,
} from "../../../src/features/anime/tracking/episode-viewing.js";
import { PlaybackEvidence } from "../../../src/features/playback/player/evidence.js";

test("normal time excludes resume, seeks, buffering and long gaps, and uses wall time at double speed", () => {
	const video = document.createElement("video");
	const evidence = new PlaybackEvidence();
	video.currentTime = 40;
	evidence.sample(video, false, 0);
	video.currentTime = 90;
	evidence.sample(video, true, 1000);
	video.currentTime = 91;
	evidence.sample(video, true, 2000);
	expect(evidence.normalPlayedMs).toBe(1000);
	video.currentTime = 150;
	evidence.sample(video, true, 3000);
	expect(evidence.normalPlayedMs).toBe(1000);
	evidence.reset();
	video.playbackRate = 2;
	evidence.sample(video, true, 4000);
	video.currentTime = 152;
	evidence.sample(video, true, 5000);
	expect(evidence.normalPlayedMs).toBe(2000);
	evidence.sample(video, false, 6000);
	video.currentTime = 154;
	evidence.sample(video, true, 7000);
	expect(evidence.normalPlayedMs).toBe(2000);
	video.currentTime = 180;
	evidence.sample(video, true, 20000);
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
