import { Check } from "typebox/value";
import { expect, test } from "vitest";
import {
	CompatibilityInspectionSchema,
	CompatibilityResultSchema,
} from "../../../../src/contracts/schemas/compatibility.js";
import {
	expectedOutputSpec,
	resolveExecutionPlan as resolvePreparationExecutionPlan,
} from "../../../../src/modules/media/media-planning/public.js";
import { presentCompatibility } from "../../../../src/transport/presenters/compatibility.js";

import {
	fixture,
	resolveExecutionPlan,
	setupTestLifecycle,
} from "./support/media-execution-planning-fixture.js";

setupTestLifecycle();

test.each([
	[160, 90, 60, 106, 60],
	[2001, 1081, undefined, 2002, 1082],
])(
	"browser, planner and validator agree on dimensions %sx%s at height %s",
	async (width, height, maxHeight, expectedWidth, expectedHeight) => {
		const f = await fixture(true, false, 0, () => "fast", { width, height });
		if (maxHeight === undefined) delete f.profile.video.maxHeight;
		else f.profile.video.maxHeight = maxHeight;
		const description = await f.inspectOutput(
			f.file.id,
			f.source.identity.sourceVersion,
		);
		const checked = await f.app.check({
			fileId: f.file.id,
			sourceVersion: description.sourceVersion,
			descriptionId: description.descriptionId,
			output: { profileId: f.profile.id, target: "file" },
			evidence: description.queries.map((query) => ({
				id: query.id,
				status:
					query.id.startsWith("original") || query.id === "copy-video"
						? "unsupported"
						: "supported",
				reason:
					query.id.startsWith("original") || query.id === "copy-video"
						? "browser-rejected"
						: "browser-supported",
				smooth: null,
			})),
		});
		const plan = resolveExecutionPlan(checked);
		if (plan.kind !== "processing" || !checked.selectedVideo)
			throw new Error("No execution");
		const expected = expectedOutputSpec(
			checked.selectedVideo,
			checked.audioTracks.map((track) => track.stream),
			plan.request.plan,
		);
		const query = description.queries.find(
			(query) => query.id === "output-encode-copy",
		);
		expect(query?.video).toMatchObject({
			width: expectedWidth,
			height: expectedHeight,
		});
		expect(expected.video).toMatchObject({
			width: expectedWidth,
			height: expectedHeight,
		});
		expect(plan.request.plan.id).toMatch(/^[a-f0-9]{64}$/);
		expect(Check(CompatibilityInspectionSchema, description)).toBe(true);
		const publicResult = presentCompatibility(checked);
		expect(Check(CompatibilityResultSchema, publicResult)).toBe(true);
		expect(description).not.toHaveProperty("audio");
		expect(publicResult).not.toHaveProperty("selectedAudio");
		expect(publicResult).not.toHaveProperty("selectedAudioTracks");
		expect(description.audioTracks[0]).not.toHaveProperty("width");
		expect(description.video).not.toHaveProperty("channels");
		expect(query?.video).not.toHaveProperty("index");
		expect(query?.video).not.toHaveProperty("codecString");
	},
);

test("non-H264 encoding omits H264 constraints and has a distinct resolver identity", async () => {
	const f = await fixture();
	const checked = await f.app.check({
		fileId: f.file.id,
		sourceVersion: f.description.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" },
		evidence: f.evidence(),
	});
	if (!checked.profile || !checked.output) throw new Error("No profile/output");
	const result = resolveExecutionPlan({
		...checked,
		profile: {
			...checked.profile,
			video: {
				encoder: "libsvtav1",
				codec: "av1",
				pixelFormat: "yuv420p",
				options: { crf: 30, preset: 8 },
			},
		},
		output: { ...checked.output, copyVideo: "unsupported" },
	});
	if (result.kind !== "processing") throw new Error("No plan");
	expect(result.request.plan).not.toHaveProperty("h264Level");
	expect(result.request.plan.id).toMatch(/^[a-f0-9]{64}$/);
});

test.each([2, 3])(
	"negotiates and resolves built-in VP9/Opus profile %s",
	async (profileIndex) => {
		const f = await fixture(true, false, profileIndex);
		expect(
			f.description.queries.find((query) => query.id === "output-encode-encode")
				?.contentType,
		).toBe('video/webm; codecs="vp9, opus"');
		const result = await f.resolve({
			"copy-video": "unsupported",
			"copy-audio": "unsupported",
		});
		expect(result).toMatchObject({
			kind: "processing",
			mode: "transcode",
			request: {
				plan: {
					container: "webm",
					video: { action: "encode", encoder: "libvpx-vp9", codec: "vp9" },
					audio: { action: "encode", encoder: "libopus", codec: "opus" },
					videoParameters: f.profile.video,
					audioParameters: f.profile.audio,
				},
			},
		});
	},
);

test.each([0, 2])(
	"copy-disabled profile %s encodes both streams regardless of source copy support",
	async (profileIndex) => {
		const f = await fixture(true, false, profileIndex);
		const request = {
			fileId: f.file.id,
			sourceVersion: f.description.sourceVersion,
			descriptionId: f.description.descriptionId,
			output: { profileId: f.profile.id, target: "file" as const },
			evidence: f.evidence(),
		};
		for (const overrides of [
			{},
			{ "copy-video": "unsupported" as const },
			{ "copy-audio": "unsupported" as const },
			{ "copy-video": "unknown" as const, "copy-audio": "unknown" as const },
		]) {
			const checked = await f.app.check({
				...request,
				evidence: f.evidence(overrides),
			});
			const result = resolvePreparationExecutionPlan({
				...checked,
				profile: checked.profile
					? { ...checked.profile, copyCompatibleStreams: false }
					: null,
			});
			expect(result).toMatchObject({
				kind: "processing",
				mode: "transcode",
				request: {
					plan: {
						container: f.profile.container,
						video: { action: "encode", encoder: f.profile.video.encoder },
						audio: { action: "encode", encoder: f.profile.audio.encoder },
					},
				},
			});
		}
		const checked = await f.app.check(request);
		const compatible = resolvePreparationExecutionPlan({
			...checked,
			profile: checked.profile
				? { ...checked.profile, copyCompatibleStreams: false }
				: null,
		});
		const fast = resolvePreparationExecutionPlan({
			...checked,
			profile: checked.profile
				? { ...checked.profile, copyCompatibleStreams: true }
				: null,
		});
		if (compatible.kind !== "processing" || fast.kind !== "processing")
			throw new Error("Missing plans");
		expect(compatible.request.plan.video.action).toBe("encode");
		if (profileIndex === 0) expect(fast.request.plan.video.action).toBe("copy");
		expect(compatible.profileFingerprint).toBe(fast.profileFingerprint);
		const rejected = await f.app.check({
			...request,
			evidence: f.evidence({ "output-encode-encode": "unsupported" }),
		});
		expect(
			resolvePreparationExecutionPlan({
				...rejected,
				profile: rejected.profile
					? { ...rejected.profile, copyCompatibleStreams: false }
					: null,
			}),
		).toMatchObject({
			kind: "blocked",
		});
	},
);

test("planning reads the current profile and rejects stale evidence after a policy edit", async () => {
	let mode: "compatible" | "fast" = "compatible";
	const f = await fixture(true, false, 0, () => mode);
	const request = {
		fileId: f.file.id,
		sourceVersion: f.description.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" as const },
		evidence: f.evidence(),
	};
	expect(await f.app.plan(request)).toMatchObject({
		kind: "processing-required",
		mode: "transcode",
	});
	mode = "fast";
	await expect(f.app.plan(request)).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
	const description = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	expect(
		await f.app.plan({ ...request, descriptionId: description.descriptionId }),
	).toMatchObject({
		kind: "processing-required",
		mode: "remux",
	});
});
