import { Check } from "typebox/value";
import { expect, test } from "vitest";
import {
	mediaTimeMs,
	originalTimeline,
	sourceTimeMs,
} from "../src/contracts/media.js";
import { PlaybackPlanSchema } from "../src/contracts/schemas/playback.js";
import { playbackPlanDto } from "../src/transport/presenters.js";

test("source mapping survives an offset restart and nonzero media origin", () => {
	const timeline = {
		sourceOriginMs: 1200000,
		mediaOriginMs: 5000,
		sourceDurationMs: 1800000,
	};
	expect(sourceTimeMs(15000, timeline)).toBe(1210000);
	expect(mediaTimeMs(1210000, timeline)).toBe(15000);
	expect(sourceTimeMs(9999999, timeline)).toBe(1800000);
	expect(sourceTimeMs(1234, originalTimeline())).toBe(1234);
	expect(() => sourceTimeMs(Number.NaN, timeline)).toThrow(RangeError);
});

test("resource contracts distinguish complete files, HLS resources and pending plans", () => {
	const resource = {
		delivery: "hls" as const,
		resourceId: "resource",
		url: "/api/hls/resource/master.m3u8",
		mimeType: "application/vnd.apple.mpegurl" as const,
		streamGeneration: 2,
		completeness: "complete" as const,
		timeline: originalTimeline(90000),
		tracks: [],
		availableRanges: [{ startMs: 0, endMs: 90000 }],
	};
	const plan = { mode: "prepared" as const, artifactId: "artifact", resource };
	expect(Check(PlaybackPlanSchema, plan)).toBe(true);
	expect(
		Check(PlaybackPlanSchema, {
			...plan,
			resource: { ...resource, completeness: "growing" },
		}),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, { mode: "preparing", taskId: "task", resource }),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, {
			...plan,
			resource: { ...resource, path: "/private/file" },
		}),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, {
			...plan,
			resource: { ...resource, mimeType: "video/mp4" },
		}),
	).toBe(false);
	const privatePlan = {
		...plan,
		resource: {
			...resource,
			timeline: { ...resource.timeline, secret: "private" },
			internalPath: "private",
		},
	};
	const dto = playbackPlanDto(privatePlan);
	expect(JSON.stringify(dto)).not.toContain("private");
	expect(dto).toEqual(plan);
});
