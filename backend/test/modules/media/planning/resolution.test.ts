import { expect, test } from "vitest";

import {
	fixture,
	resolveExecutionPlan,
	setupTestLifecycle,
} from "./support/media-execution-planning-fixture.js";

setupTestLifecycle();

test.each([
	[{}, "remux", "copy", "copy"],
	[{ "copy-audio": "unsupported" }, "transcode-audio", "copy", "encode"],
	[{ "copy-video": "unsupported" }, "transcode-video", "encode", "copy"],
	[
		{ "copy-video": "unsupported", "copy-audio": "unsupported" },
		"transcode",
		"encode",
		"encode",
	],
] as const)(
	"selects minimum operations: %s",
	async (overrides, mode, video, audio) => {
		const f = await fixture();
		const result = await f.resolve(overrides);
		expect(result).toMatchObject({
			kind: "processing",
			mode,
			request: {
				videoStreamIndex: 2,
				audioStreamIndices: [4],
				plan: { video: { action: video }, audio: { action: audio } },
			},
		});
		if (result.kind === "processing") {
			expect(Object.isFrozen(result.request.plan)).toBe(true);
			expect(result.request.plan.id).toMatch(/^[a-f0-9]{64}$/);
		}
	},
);

test("supported originals resolve to direct", async () => {
	const f = await fixture();
	expect(
		await f.resolve({
			original: "supported",
			"original-container": "supported",
		}),
	).toMatchObject({ kind: "direct" });
});

test("unknown copy evidence falls back to encoding; rejected known combinations block", async () => {
	const f = await fixture();
	expect(await f.resolve({ "copy-video": "unknown" })).toMatchObject({
		kind: "processing",
	});
	expect(await f.resolve({ "output-copy-copy": "unsupported" })).toMatchObject({
		kind: "blocked",
		reason: "output-combination-unverified",
	});
});

test("profile transformations require encoding and include concrete parameters", async () => {
	const f = await fixture();
	f.profile.video.maxHeight = 720;
	f.profile.audio.channels = 2;
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	const result = await f.resolveInput({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: description.descriptionId,
		evidence: f.evidence(),
	});
	expect(result).toMatchObject({
		kind: "processing",
		mode: "transcode",
		reasons: {
			video: "profile-size-required",
			audio: "profile-stereo-required",
		},
		request: {
			plan: {
				videoParameters: { maxHeight: 720 },
				audioParameters: { channels: 2 },
				videoFilters: [
					"scale=w=-2:h=720:flags=lanczos",
					"pad=ceil(iw/2)*2:ceil(ih/2)*2",
					"format=yuv420p",
				],
			},
		},
	});
});

test("video-only selection permits encoding an output whose browser support is unknown", async () => {
	const f = await fixture(false);
	expect(await f.resolve()).toMatchObject({
		kind: "processing",
		request: { audioStreamIndices: [] },
		reasons: { audio: "no-audio-stream" },
	});
	f.profile.video = {
		encoder: "libsvtav1",
		codec: "av1",
		pixelFormat: "yuv420p",
		options: { crf: 30, preset: 8 },
	};
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	expect(
		description.queries.find((q) => q.id === "output-encode-copy")?.contentType,
	).toBeNull();
	expect(
		await f.resolveInput({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: description.descriptionId,
			evidence: f.evidence({ "copy-video": "unsupported" }),
		}),
	).toMatchObject({ kind: "processing" });
});

test("MSE evidence is distinct from file evidence and selects fragmented MP4", async () => {
	const f = await fixture();
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
		undefined,
		"media-source",
	);
	expect(description.descriptionId).not.toBe(f.description.descriptionId);
	expect(
		description.queries.find((query) => query.id === "copy-video")?.type,
	).toBe("media-source");
	const result = await f.resolveInput({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		output: { profileId: f.profile.id, target: "media-source" },
		descriptionId: description.descriptionId,
		evidence: f.evidence(),
	});
	expect(result).toMatchObject({
		kind: "processing",
		request: { plan: { delivery: "media-source", container: "mp4" } },
	});
	await expect(
		f.resolveInput({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			output: { profileId: f.profile.id, target: "media-source" },
			descriptionId: f.description.descriptionId,
			evidence: f.evidence(),
		}),
	).rejects.toThrow("stale");
});

test("resolver consumes an immutable checked snapshot without consulting current configuration", async () => {
	const f = await fixture();
	const checked = await f.app.check({
		output: { profileId: f.profile.id, target: "file" },
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		evidence: f.evidence({ "copy-video": "unsupported" }),
	});
	const first = resolveExecutionPlan(checked);
	f.profile.video.options = {
		...f.profile.video.options,
		crf: Number(f.profile.video.options?.crf ?? 23) + 1,
	};
	expect(resolveExecutionPlan(checked)).toEqual(first);
	expect(Object.isFrozen(checked.profile?.video)).toBe(true);
	expect(checked).not.toHaveProperty("evidence");
	expect(checked).not.toHaveProperty("queries");
});
