// @vitest-environment happy-dom

import { originalTimeline } from "@anishelf/backend/contracts/media";
import { expect, test } from "vitest";
import {
	episodeViewing,
	episodeViewingCounts,
} from "../src/features/anime/tracking/episode-viewing.js";
import { PlaybackEvidence } from "../src/features/playback/player/evidence.js";

test("records source time at playback speed, breaks continuity on seeks/buffering and ignores resume", () => {
	const video = document.createElement("video");
	const evidence = new PlaybackEvidence();
	const timeline = originalTimeline();
	video.currentTime = 40;
	evidence.sample(video, timeline, false, 0);
	video.currentTime = 50;
	evidence.sample(video, timeline, true, 1000);
	video.currentTime = 51;
	evidence.sample(video, timeline, true, 2000);
	expect(evidence.take()).toEqual([
		{ startMs: 50000, endMs: 51000, elapsedMs: 1000, rate: 1 },
	]);
	evidence.reset();
	video.currentTime = 90;
	evidence.sample(video, timeline, true, 3000);
	video.currentTime = 91;
	evidence.sample(video, timeline, true, 4000);
	expect(evidence.take()).toEqual([
		{ startMs: 90000, endMs: 91000, elapsedMs: 1000, rate: 1 },
	]);
	evidence.sample(video, timeline, false, 5000);
	video.currentTime = 95;
	evidence.sample(video, timeline, true, 9000);
	expect(evidence.take()).toEqual([]);
	video.playbackRate = 2;
	evidence.reset();
	evidence.sample(video, timeline, true, 10000);
	video.currentTime = 97;
	evidence.sample(video, timeline, true, 11000);
	expect(evidence.take()).toEqual([
		{ startMs: 95000, endMs: 97000, elapsedMs: 1000, rate: 2 },
	]);
});

test("maps prepared media evidence to original source time and drops long unobserved gaps", () => {
	const video = document.createElement("video");
	const evidence = new PlaybackEvidence();
	const timeline = {
		sourceOriginMs: 30000,
		mediaOriginMs: 10000,
		sourceDurationMs: 100000,
	};
	video.currentTime = 10;
	evidence.sample(video, timeline, true, 0);
	video.currentTime = 11;
	evidence.sample(video, timeline, true, 1000);
	expect(evidence.take()).toEqual([
		{ startMs: 30000, endMs: 31000, elapsedMs: 1000, rate: 1 },
	]);
	video.currentTime = 30;
	evidence.sample(video, timeline, true, 20000);
	expect(evidence.take()).toEqual([]);
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
