import { expect, test } from "vitest";
import { chapterCues } from "../src/features/playback/chapters.js";

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
