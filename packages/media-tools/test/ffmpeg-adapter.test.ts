import { expect, test } from "vitest";
import {
	compileFfmpegArguments,
	type MediaProcessingOptions,
} from "../src/index.ts";
import type { MediaProcessingPlan } from "../src/specification.ts";

const maximumOutputBytes = 10 * 1024 * 1024;
function options(plan: MediaProcessingPlan): MediaProcessingOptions {
	return {
		plan,
		videoStreamIndex: 2,
		audioStreamIndices: [4],
		maximumBytes: maximumOutputBytes,
		timeoutMs: 30000,
	};
}
const copy: MediaProcessingPlan = {
	id: "test",
	container: "mp4",
	outputFormat: "mp4",
	video: { action: "copy" },
	audio: { action: "copy" },
	filters: [],
};

test("maps explicit streams, preserves copy paths, sets faststart and uses literal local paths", () => {
	const args = compileFfmpegArguments(
		"/tmp/电影 $(id).mkv",
		"/tmp/output.pending",
		options(copy),
	);
	expect(args).toContain("/tmp/电影 $(id).mkv");
	expect(args).toContain("0:2");
	expect(args).toContain("0:4");
	expect(args).toContain("+faststart");
	expect(args).not.toContain("-vf");
	expect(args).not.toContain("-crf");
	expect(
		compileFfmpegArguments("/tmp/in", "/tmp/out", {
			...options(copy),
			audioStreamIndices: [],
		}),
	).toContain("-an");
	expect(() =>
		compileFfmpegArguments("https://example.com/in", "/tmp/out", options(copy)),
	).toThrow("paths");
	expect(() =>
		compileFfmpegArguments("/tmp/in", "/tmp/in", options(copy)),
	).toThrow("paths");
});

test("encoder-specific settings compile without accepting raw graphs or mismatched parameters", () => {
	const plan: MediaProcessingPlan = {
		...copy,
		video: {
			action: "encode",
			encoder: "libsvtav1",
			codec: "av1",
			pixelFormat: "yuv420p",
		},
		videoParameters: {
			encoder: "libsvtav1",
			codec: "av1",
			pixelFormat: "yuv420p",
			options: { crf: 30, preset: 8 },
		},
		filters: ["buffer", "buffersink", "null", "scale"],
	};
	expect(
		compileFfmpegArguments("/tmp/in", "/tmp/out", options(plan)),
	).toContain("8");
	expect(() =>
		compileFfmpegArguments(
			"/tmp/in",
			"/tmp/out",
			options({ ...plan, filters: [] }),
		),
	).toThrow("filters");
	expect(() =>
		compileFfmpegArguments(
			"/tmp/in",
			"/tmp/out",
			options({ ...plan, videoFilters: ["movie=/etc/passwd"] }),
		),
	).toThrow("filter");
	expect(() =>
		compileFfmpegArguments(
			"/tmp/in",
			"/tmp/out",
			options({
				...plan,
				videoParameters: {
					encoder: "libx264",
					codec: "h264",
					pixelFormat: "yuv420p",
					options: { crf: 23, preset: "medium" },
				},
			}),
		),
	).toThrow("parameters");
});
