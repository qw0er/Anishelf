import { expect, test } from "vitest";
import {
	chapterCues,
	playerChapters,
} from "../../../src/features/playback/player/chapters.js";

test("engine chapters use rational asset timestamps, sorted starts and optional titles", () => {
	const chapter = {
		id: 1n,
		start: 90090n,
		end: 180000n,
		timeBase: { num: 1, den: 90000 },
		metadata: { title: " Main " },
	};
	expect(
		playerChapters([
			chapter,
			{ ...chapter, id: 2n, start: 0n, metadata: { title: " " } },
			{ ...chapter, start: -90000n },
			{ ...chapter, timeBase: { num: 1, den: 0 } },
			{ ...chapter, start: 9007199254740992000000n },
		]),
	).toEqual([
		{ id: "2", startMs: 0, title: null },
		{ id: "1", startMs: 1001, title: "Main" },
	]);
});

test("maps source chapters to direct and shifted prepared timelines", () => {
	const chapters = [
		{ title: "Opening", startMs: 0, endMs: 10000 },
		{ title: null, startMs: 10000, endMs: 30000 },
	];
	expect(
		chapterCues(chapters, {
			sourceOriginMs: 0,
			mediaOriginMs: 0,
			sourceDurationMs: 20000,
		}),
	).toEqual([
		{ text: "Opening", startTime: 0, endTime: 10 },
		{ text: "Chapter 2", startTime: 10, endTime: 20 },
	]);
	expect(
		chapterCues(chapters, {
			sourceOriginMs: 15000,
			mediaOriginMs: 2000,
			sourceDurationMs: 20000,
		}),
	).toEqual([{ text: "Chapter 2", startTime: 2, endTime: 7 }]);
	expect(
		chapterCues([], {
			sourceOriginMs: 0,
			mediaOriginMs: 0,
			sourceDurationMs: null,
		}),
	).toEqual([]);
});
