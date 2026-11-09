import { expect, test } from "vitest";
import { resolveExecutionPlan as resolve } from "../../../../src/modules/media/media-planning/public.js";
import {
	fixture,
	setupTestLifecycle,
} from "./support/media-execution-planning-fixture.js";

setupTestLifecycle();

async function matchingFixture(secondAudio = false) {
	const f = await fixture(true, secondAudio, 0, () => "compatible");
	f.profile.video = {
		encoder: "libx264",
		codec: "h264",
		options: { crf: 30, preset: "slow" },
	};
	f.profile.audio = { encoder: "aac", codec: "aac", options: { b: "128k" } };
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	const request = {
		fileId: f.file.id,
		sourceVersion: description.sourceVersion,
		descriptionId: description.descriptionId,
		output: { profileId: f.profile.id, target: "file" as const },
	};
	return { ...f, description, request };
}

test.each(["unsupported", "unknown"] as const)(
	"remuxes MKV H264/AAC into MP4 independently of %s browser evidence",
	async (status) => {
		const f = await matchingFixture();
		const plan = await f.app.plan(
			{
				...f.request,
				evidence: f.description.queries.map((query) => ({
					id: query.id,
					status,
					reason:
						status === "unsupported"
							? ("browser-rejected" as const)
							: ("browser-uncertain" as const),
					smooth: null,
				})),
			},
			{ forcePreparation: true },
		);
		expect(plan).toMatchObject({
			kind: "processing-required",
			mode: "remux",
			reasons: { video: "profile-matched", audio: "profile-matched" },
			execution: {
				plan: {
					container: "mp4",
					video: { action: "copy" },
					audioTracks: [{ sourceIndex: 4, execution: { action: "copy" } }],
					filters: [],
				},
			},
		});
		if (plan.kind !== "processing-required") throw new Error("Missing plan");
		expect(plan.execution.plan.videoParameters).toBeUndefined();
		expect(plan.execution.plan.audioTracks?.[0]?.parameters).toBeUndefined();
	},
);

test("matches each retained audio stream separately", async () => {
	const f = await matchingFixture(true);
	const checked = await f.app.check({
		...f.request,
		evidence: f.evidence({
			"copy-video": "unsupported",
			"copy-audio": "unsupported",
			"copy-audio-7": "unsupported",
		}),
	});
	expect(resolve(checked, true)).toMatchObject({
		kind: "processing",
		mode: "transcode-audio",
		request: {
			plan: {
				video: { action: "copy" },
				audioTracks: [
					{ sourceIndex: 4, execution: { action: "copy" } },
					{ sourceIndex: 7, execution: { action: "encode", codec: "aac" } },
				],
			},
		},
	});
});

test("an explicit but unknown source field falls back to encoding", async () => {
	const f = await matchingFixture();
	const checked = await f.app.check({
		...f.request,
		evidence: f.evidence({ "copy-video": "unknown", "copy-audio": "unknown" }),
	});
	if (!checked.profile || !checked.selectedVideo)
		throw new Error("Missing profile/video");
	const result = resolve(
		{
			...checked,
			selectedVideo: { ...checked.selectedVideo, frameRate: null },
			profile: {
				...checked.profile,
				video: {
					...checked.profile.video,
					maxFrameRate: 24,
				},
				audio: { ...checked.profile.audio, sampleRate: 48000 },
			},
		},
		true,
	);
	expect(result).toMatchObject({
		kind: "processing",
		mode: "transcode",
		request: {
			plan: { video: { action: "encode" }, audio: { action: "encode" } },
		},
	});
});

test("codec mismatch still encodes while compatibility copying remains a separate opt-in path", async () => {
	const f = await matchingFixture();
	f.profile.video.codec = "hevc";
	f.profile.video.encoder = "libx265";
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	const checked = await f.app.check({
		...f.request,
		descriptionId: description.descriptionId,
		evidence: f.evidence(),
	});
	expect(resolve(checked, true)).toMatchObject({
		kind: "processing",
		request: { plan: { video: { action: "encode", codec: "hevc" } } },
	});
	if (!checked.profile) throw new Error("Missing profile");
	expect(
		resolve(
			{
				...checked,
				profile: { ...checked.profile, copyCompatibleStreams: true },
			},
			true,
		),
	).toMatchObject({
		kind: "processing",
		request: { plan: { video: { action: "copy" } } },
	});
});

test("target-matching forced copies do not need browser support", async () => {
	const f = await matchingFixture();
	const checked = await f.app.check({
		...f.request,
		evidence: f.evidence({
			"copy-video": "unsupported",
			"copy-audio": "unsupported",
		}),
	});
	if (!checked.profile) throw new Error("Missing profile");
	expect(
		resolve(
			{
				...checked,
				profile: {
					...checked.profile,
					video: { encoder: "copy", codec: "h264" },
					audio: { encoder: "copy", codec: "aac" },
				},
			},
			true,
		),
	).toMatchObject({ kind: "processing", mode: "remux" });
});

test("encoding profile and level options do not require matching source metadata", async () => {
	const f = await matchingFixture();
	f.profile.video.options = { profile: "high", level: "4.1" };
	f.profile.audio.options = { profile: "aac_low", b: "192k" };
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	const plan = await f.app.plan(
		{
			...f.request,
			descriptionId: description.descriptionId,
			evidence: f.evidence({
				"copy-video": "unsupported",
				"copy-audio": "unsupported",
			}),
		},
		{ forcePreparation: true },
	);
	expect(plan).toMatchObject({
		kind: "processing-required",
		mode: "remux",
		execution: {
			plan: {
				video: { action: "copy" },
				audioTracks: [{ execution: { action: "copy" } }],
			},
		},
	});
	if (plan.kind !== "processing-required") throw new Error("Missing plan");
	expect(plan.execution.plan.videoParameters).toBeUndefined();
	expect(plan.execution.plan.audioTracks?.[0]?.parameters).toBeUndefined();
});
