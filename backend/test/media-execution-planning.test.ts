import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityEvidence,
} from "../src/contracts/http.js";
import {
	CompatibilityInspectionSchema,
	CompatibilityResultSchema,
} from "../src/contracts/schemas/compatibility.js";
import { PlaybackPlanSchema } from "../src/contracts/schemas/playback.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { MediaPlanningApplication } from "../src/modules/media-planning/application/planning.js";
import { resolveHlsExecutionPlan } from "../src/modules/media-planning/domain/hls-execution-plan.js";
import {
	expectedOutputSpec,
	resolveExecutionPlan as resolvePreparationExecutionPlan,
} from "../src/modules/media-planning/public.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { fingerprint } from "../src/shared/fingerprint.js";
import { presentCompatibility } from "../src/transport/presenters/compatibility.js";
import { settingsStore } from "./settings-store.js";

const resolveExecutionPlan = (
	input: Parameters<typeof resolvePreparationExecutionPlan>[0],
) => resolvePreparationExecutionPlan(input, "fast");

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture(
	audio = true,
	secondAudio = false,
	profileIndex = 0,
	preparationMode: () => "compatible" | "fast" = () => "fast",
) {
	const root = await mkdtemp(join(tmpdir(), "anishelf-planning-"));
	await writeFile(join(root, "source.mkv"), "source");
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger: pino({ enabled: false }),
	});
	await library.startScan();
	await library.waitForCompletion();
	const file = [...index.snapshot.entriesById.values()].find(
		(e) => e.kind === "file",
	);
	if (!file) throw new Error("Missing file");
	const source = await library.sources.resolveSource(file.id);
	const info = parseMediaInfo(
		JSON.stringify({
			format: { format_name: "matroska", duration: "2" },
			streams: [
				{
					index: 2,
					codec_type: "video",
					codec_name: "h264",
					width: 1920,
					height: 1080,
					avg_frame_rate: "24/1",
					pix_fmt: "yuv420p",
				},
				...(audio
					? [{ index: 4, codec_type: "audio", codec_name: "aac", channels: 6 }]
					: []),
			],
		}),
		"matroska",
	);
	const video = info.streams[0];
	if (video) video.codecString = "avc1.640028";
	const a = info.streams[1];
	if (a) a.codecString = "mp4a.40.2";
	if (secondAudio && a)
		info.streams.push({
			...a,
			index: 7,
			codec: "ac3",
			codecString: "ac-3",
			tags: { language: "jpn", title: "Japanese" },
		});
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe: vi.fn().mockResolvedValue(info) },
	});
	const profile = structuredClone(
		builtinTranscodeProfiles[profileIndex],
	) as TranscodeProfile;
	const profiles = [profile];
	const app = new MediaPlanningApplication({
		sources: library.sources,
		inspection,
		profiles,
		preparationMode,
	});
	cleanup.push(async () => {
		await inspection.close();
		await library.close();
		await rm(root, { recursive: true, force: true });
	});
	const inspectOutput = (
		fileId: string,
		sourceVersion: string,
		profileId = profile.id,
		target: "file" | "media-source" = "file",
	) => app.inspect({ fileId, sourceVersion, output: { profileId, target } });
	const description = await inspectOutput(
		file.id,
		source.identity.sourceVersion,
	);
	const evidence = (
		overrides: Record<string, CompatibilityEvidence["status"]> = {},
	): CompatibilityEvidence[] =>
		description.queries.map((query) => {
			const status =
				overrides[query.id] ??
				(query.id.startsWith("original") ? "unsupported" : "supported");
			return {
				id: query.id,
				status,
				reason:
					status === "supported"
						? "browser-supported"
						: status === "unsupported"
							? "browser-rejected"
							: "browser-uncertain",
				smooth: null,
			};
		});
	const resolveInput = async (
		input: Omit<CompatibilityCheckRequest, "output"> & {
			fileId: string;
			output?: CompatibilityCheckRequest["output"];
		},
	) =>
		resolveExecutionPlan(
			await app.check({
				...input,
				output: input.output ?? { profileId: profile.id, target: "file" },
			}),
		);
	const resolve = (overrides = {}) =>
		resolveInput({
			fileId: file.id,
			sourceVersion: source.identity.sourceVersion,
			descriptionId: description.descriptionId,
			evidence: evidence(overrides),
		});
	return {
		app,
		resolve,
		description,
		evidence,
		profile,
		profiles,
		resolveInput,
		inspectOutput,
		file,
		source,
		info,
		library,
	};
}
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
			expect(result.request.plan.id).toBe(
				fingerprint({
					version: "preparation-execution:2",
					fileId: f.file.id,
					root: f.source.identity.canonicalRoot,
					sourceVersion: f.description.sourceVersion,
					profileFingerprint: f.description.output?.profileFingerprint,
					delivery: "file",
					video: 2,
					audio: [4],
					v: video,
					a: audio,
				}),
			);
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
test("missing/unknown evidence and rejected combinations never authorize processing", async () => {
	const f = await fixture();
	expect(await f.resolve({ "copy-video": "unknown" })).toMatchObject({
		kind: "blocked",
	});
	expect(await f.resolve({ "output-copy-copy": "unsupported" })).toMatchObject({
		kind: "blocked",
		reason: "output-combination-unverified",
	});
});
test("profile content changes invalidate evidence; metadata and key order do not", async () => {
	const f = await fixture();
	f.profile.name = "Renamed";
	const renamed = await f.inspectOutput(
		f.file.id,
		f.source.identity.sourceVersion,
	);
	expect(renamed.descriptionId).toBe(f.description.descriptionId);
	if ("crf" in f.profile.video) f.profile.video.crf += 1;
	await expect(f.resolve()).rejects.toThrow("stale");
});
test("profile transformations require encoding and include concrete parameters", async () => {
	const f = await fixture();
	f.profile.video.maxHeight = 720;
	f.profile.audio.channels = "stereo";
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
				audioParameters: { channels: "stereo" },
				videoFilters: [
					"scale=w=-2:h=720:flags=lanczos",
					"pad=ceil(iw/2)*2:ceil(ih/2)*2",
					"format=yuv420p",
				],
			},
		},
	});
});
test("video-only selection and unknown encoded profile descriptions fail safely", async () => {
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
		crf: 30,
		preset: 8,
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
	).toMatchObject({ kind: "blocked" });
});
test("duplicate compatibility evidence is rejected", async () => {
	const f = await fixture();
	await expect(
		f.resolveInput({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			evidence: [...f.evidence(), f.evidence()[0] as CompatibilityEvidence],
		}),
	).rejects.toThrow("evidence");
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

test("source-only and output-context checks share evidence validation", async () => {
	const f = await fixture();
	const invalid: CompatibilityEvidence = {
		id: "original",
		status: "unknown",
		reason: "browser-supported",
		smooth: null,
	};
	const original = await f.app.inspect({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
	});
	await expect(
		f.app.check({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: original.descriptionId,
			output: null,
			evidence: [invalid],
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await expect(
		f.app.check({
			output: { profileId: f.profile.id, target: "file" },
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			evidence: [invalid],
		}),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
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
	if ("crf" in f.profile.video) f.profile.video.crf += 1;
	expect(resolveExecutionPlan(checked)).toEqual(first);
	expect(Object.isFrozen(checked.profile?.video)).toBe(true);
	expect(checked).not.toHaveProperty("evidence");
	expect(checked).not.toHaveProperty("queries");
});

test("media planning validates evidence without opening history or claiming resource readiness", async () => {
	const f = await fixture();
	const playback = new PlaybackApplication({
		sources: f.library.sources,
		logger: pino({ enabled: false }),
	});
	const input = {
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" as const },
		evidence: f.evidence(),
	};
	const result = await f.app.plan(input);
	expect(result.kind).toBe("processing-required");
	if (result.kind !== "processing-required") throw new Error("Missing work");
	expect(result.target).toBe("file");
	expect(result.mode).toBe("remux");
	expect(result.identity).toMatchObject({
		fileId: f.file.id,
		sourceVersion: input.sourceVersion,
		executionPlanId: result.execution.plan.id,
		videoStreamIndex: 2,
		audioStreamIndices: [4],
	});
	expect(JSON.stringify(result.identity)).not.toContain(
		f.source.identity.canonicalRoot,
	);
	expect(Object.isFrozen(result.execution.plan)).toBe(true);
	expect(result).not.toHaveProperty("playbackUrl");
	expect(result).not.toHaveProperty("taskId");
	await expect(playback.open(f.file.id)).rejects.toMatchObject({
		code: "PLAYBACK_UNAVAILABLE",
	});
	await expect(
		f.app.plan({ ...input, descriptionId: "stale" }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	const direct = await f.app.plan({
		...input,
		evidence: f.evidence(
			Object.fromEntries(f.description.queries.map((q) => [q.id, "supported"])),
		),
	});
	expect(direct).toEqual({
		kind: "playable",
		fileId: f.file.id,
		mimeType: "video/x-matroska",
	});

	const blocked = await f.app.plan({
		...input,
		evidence: f.evidence({ "copy-video": "unknown" }),
	});
	expect(blocked).toEqual({
		kind: "blocked",
		reason: "source-stream-compatibility-unknown",
	});
	f.app.close();
	await expect(f.app.plan(input)).rejects.toMatchObject({
		code: "MEDIA_PLANNING_UNAVAILABLE",
	});
});

test("media planning rejects a root change while compatibility is awaited", async () => {
	const f = await fixture();
	const otherRoot = await mkdtemp(join(tmpdir(), "anishelf-planning-other-"));
	cleanup.push(() => rm(otherRoot, { recursive: true, force: true }));
	const original = f.app.check.bind(f.app);
	vi.spyOn(f.app, "check").mockImplementationOnce(async (input) => {
		const checked = await original(input);
		await f.library.updateSettings({ resourceRoot: otherRoot });
		return checked;
	});
	await expect(
		f.app.plan({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			output: { profileId: f.profile.id, target: "file" },
			evidence: f.evidence(),
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});

test("playback resource contracts reject premature URLs and private execution fields", () => {
	expect(Check(PlaybackPlanSchema, { mode: "preparing", taskId: "task" })).toBe(
		false,
	);
	expect(
		Check(PlaybackPlanSchema, {
			mode: "preparing",
			taskId: "task",
			playbackUrl: "/partial.mp4",
		}),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, { mode: "prepared", artifactId: "artifact" }),
	).toBe(false);
	expect(
		Check(PlaybackPlanSchema, {
			mode: "direct",
			playbackUrl: "/api/media/file",
			path: "/private/source",
		}),
	).toBe(false);
});

test("checks every audio track and defaults execution to all audio streams", async () => {
	const f = await fixture(true, true);
	expect(f.description.audioTracks?.map((track) => track.index)).toEqual([
		4, 7,
	]);
	const checked = await f.app.check({
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" },
		evidence: f.evidence({
			"original-audio": "supported",
			"original-audio-7": "unsupported",
			"copy-audio-7": "unsupported",
		}),
	});
	expect(checked.audio.status).toBe("unsupported");
	expect(checked.audioTracks).toMatchObject([
		{ stream: { index: 4 }, compatibility: { status: "supported" } },
		{
			stream: { index: 7, language: "jpn", label: "Japanese" },
			compatibility: { status: "unsupported" },
		},
	]);
	const plan = resolveExecutionPlan(checked);
	expect(plan).toMatchObject({
		kind: "processing",
		mode: "transcode-audio",
		request: {
			audioStreamIndices: [4, 7],
			plan: { audio: { action: "encode" } },
		},
	});
	expect(
		resolveExecutionPlan(
			await f.app.check({
				fileId: f.file.id,
				sourceVersion: f.source.identity.sourceVersion,
				descriptionId: f.description.descriptionId,
				output: { profileId: f.profile.id, target: "file" },
				evidence: f.evidence({ "copy-audio-7": "unknown" }),
			}),
		),
	).toEqual({ kind: "blocked", reason: "source-stream-compatibility-unknown" });
});

test("audio selection binds evidence and execution identity, preserving requested order and video-only selection", async () => {
	const f = await fixture(true, true);
	const plans = [];
	for (const selection of [[7], [7, 4], []]) {
		const output = { profileId: f.profile.id, target: "file" as const };
		const description = await f.app.inspect({
			fileId: f.file.id,
			output,
			audioStreamIndices: selection,
		});
		expect(description.audioTracks).toHaveLength(2);
		expect(description.selectedAudioStreamIndices).toEqual(selection);
		const evidence = description.queries.map((query) => ({
			id: query.id,
			status: "supported" as const,
			reason: "browser-supported" as const,
			smooth: null,
		}));
		const request = {
			fileId: f.file.id,
			sourceVersion: description.sourceVersion,
			descriptionId: description.descriptionId,
			output,
			evidence,
			audioStreamIndices: selection,
		};
		const plan = resolveExecutionPlan(await f.app.check(request));
		expect(plan).toMatchObject({
			kind: "processing",
			request: { audioStreamIndices: selection },
		});
		if (plan.kind !== "processing") throw new Error("Missing plan");
		plans.push(plan.request.plan.id);
		await expect(
			f.app.check({ ...request, audioStreamIndices: [4] }),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	}
	expect(new Set(plans).size).toBe(3);
	for (const audioStreamIndices of [[0], [4, 4], [-1], [99]]) {
		await expect(
			f.app.inspect({ fileId: f.file.id, audioStreamIndices }),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	}
});

test("HLS planning binds MSE evidence, preserves compatible audio and encodes only the rejected track", async () => {
	const f = await fixture(true, true);
	const output = { profileId: f.profile.id, target: "media-source" as const };
	const description = await f.app.inspect({ fileId: f.file.id, output });
	const rejected = new Set([
		"copy-audio-7",
		"output-copy-copy-7",
		"output-encode-copy-7",
	]);
	const evidence = description.queries.map(
		(query): CompatibilityEvidence => ({
			id: query.id,
			status: rejected.has(query.id) ? "unsupported" : "supported",
			reason: rejected.has(query.id) ? "browser-rejected" : "browser-supported",
			smooth: null,
		}),
	);
	const input = {
		fileId: f.file.id,
		sourceVersion: description.sourceVersion,
		descriptionId: description.descriptionId,
		output,
		evidence,
	};
	const negotiated = await f.app.check(input);
	if (!negotiated.output) throw new Error("Missing output");
	const checked = {
		...negotiated,
		output: { ...negotiated.output, target: "hls" as const },
	};
	expect(
		description.queries
			.filter((query) => !query.id.startsWith("original"))
			.every((query) => query.type === "media-source"),
	).toBe(true);
	const plan = resolveHlsExecutionPlan(checked);
	expect(plan).toMatchObject({
		kind: "processing",
		request: {
			plan: {
				delivery: "hls",
				segmentContainer: "fmp4",
				video: { action: "copy" },
				audioTracks: [
					{ sourceStreamIndex: 4, execution: { action: "copy" } },
					{
						sourceStreamIndex: 7,
						execution: { action: "encode", codec: "aac" },
					},
				],
			},
		},
	});
	if (plan.kind !== "processing") throw new Error("Expected HLS plan");
	expect(Object.isFrozen(plan.request.plan.audioTracks)).toBe(true);
	const changed = resolveHlsExecutionPlan(checked, 4000);
	if (changed.kind !== "processing") throw new Error("Expected HLS plan");
	expect(changed.request.plan.id).not.toBe(plan.request.plan.id);
	// Native-file acceptance cannot skip offline HLS packaging.
	expect(
		resolveHlsExecutionPlan({
			...checked,
			direct: { status: "supported", reason: "browser-supported" },
		}).kind,
	).toBe("processing");
	const playback = new PlaybackApplication({
		sources: f.library.sources,
		logger: pino({ enabled: false }),
	});
	const open = vi.spyOn(playback, "open");
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		playback,
		mediaPlanning: f.app,
	});
	try {
		const response = await http.inject({
			method: "POST",
			url: "/api/media/plans",
			headers: { host: "127.0.0.1:3000" },
			payload: input,
		});
		expect(response.statusCode).toBe(404);
		expect(open).not.toHaveBeenCalled();
		const removed = await http.inject({
			method: "POST",
			url: "/api/playback/plans",
			headers: { host: "127.0.0.1:3000" },
			payload: input,
		});
		expect(removed.statusCode).toBe(404);
		const unsupportedTarget = await http.inject({
			method: "POST",
			url: `/api/files/${f.file.id}/compatibility`,
			headers: { host: "127.0.0.1:3000" },
			payload: {
				...input,
				fileId: undefined,
				output: { ...output, target: "hls" },
			},
		});
		expect(unsupportedTarget.statusCode).toBe(400);
	} finally {
		await http.close();
	}
});

test.each([
	[160, 90, 60, 106, 60],
	[2001, 1081, undefined, 2002, 1082],
])(
	"browser, planner and validator agree on dimensions %sx%s at height %s",
	async (width, height, maxHeight, expectedWidth, expectedHeight) => {
		const f = await fixture();
		const sourceVideo = f.info.streams[0];
		if (!sourceVideo) throw new Error("No source video");
		sourceVideo.width = width ?? null;
		sourceVideo.height = height ?? null;
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
		expect(plan.request.plan.id).toBe(
			fingerprint({
				version: "preparation-execution:2",
				fileId: f.file.id,
				root: f.source.identity.canonicalRoot,
				sourceVersion: description.sourceVersion,
				profileFingerprint: checked.output?.profileFingerprint,
				delivery: "file",
				video: 2,
				audio: [4],
				v: "encode",
				a: "copy",
			}),
		);
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
				crf: 30,
				preset: 8,
			},
		},
		output: { ...checked.output, copyVideo: "unsupported" },
	});
	if (result.kind !== "processing") throw new Error("No plan");
	expect(result.request.plan).not.toHaveProperty("h264Level");
	expect(result.request.plan.id).toBe(
		fingerprint({
			version: "preparation-execution:3",
			fileId: f.file.id,
			root: f.source.identity.canonicalRoot,
			sourceVersion: f.description.sourceVersion,
			profileFingerprint: checked.output.profileFingerprint,
			delivery: "file",
			video: 2,
			audio: [4],
			v: "encode",
			a: "copy",
		}),
	);
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
	"compatibility mode encodes both streams using profile %s regardless of source copy support",
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
			const result = resolvePreparationExecutionPlan(checked);
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
		const compatible = resolvePreparationExecutionPlan(checked);
		const fast = resolvePreparationExecutionPlan(checked, "fast");
		if (compatible.kind !== "processing" || fast.kind !== "processing")
			throw new Error("Missing plans");
		expect(compatible.request.plan.id).not.toBe(fast.request.plan.id);
		expect(compatible.profileFingerprint).toBe(fast.profileFingerprint);
		const rejected = await f.app.check({
			...request,
			evidence: f.evidence({ "output-encode-encode": "unsupported" }),
		});
		expect(resolvePreparationExecutionPlan(rejected)).toMatchObject({
			kind: "blocked",
		});
	},
);

test("planning reads the current preparation mode for each request", async () => {
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
	expect(await f.app.plan(request)).toMatchObject({
		kind: "processing-required",
		mode: "remux",
	});
});

test("compatibility mode without audio still uses the full-transcode mode", async () => {
	const f = await fixture(false);
	const checked = await f.app.check({
		fileId: f.file.id,
		sourceVersion: f.description.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" },
		evidence: f.evidence(),
	});
	expect(resolvePreparationExecutionPlan(checked)).toMatchObject({
		kind: "processing",
		mode: "transcode",
		request: { audioStreamIndices: [], plan: { video: { action: "encode" } } },
	});
});
