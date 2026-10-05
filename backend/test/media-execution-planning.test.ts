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
import { PlaybackPlanSchema } from "../src/contracts/schemas/playback.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../src/modules/media-compatibility/application/compatibility.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import {
	resolveExecutionPlan,
	resolveHlsExecutionPlan,
} from "../src/modules/media-processing/public.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { settingsStore } from "./settings-store.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture(audio = true, secondAudio = false) {
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
		builtinTranscodeProfiles[0],
	) as TranscodeProfile;
	const profiles = [profile];
	const app = new MediaCompatibilityApplication({
		sources: library.sources,
		inspection,
		profiles,
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
				powerEfficient: null,
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
		if (result.kind === "processing")
			expect(Object.isFrozen(result.request.plan)).toBe(true);
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
		powerEfficient: null,
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

test("playback planning validates evidence without opening history or claiming resource readiness", async () => {
	const f = await fixture();
	const playback = new PlaybackApplication({
		sources: f.library.sources,
		compatibility: f.app,
		logger: pino({ enabled: false }),
	});
	const input = {
		fileId: f.file.id,
		sourceVersion: f.source.identity.sourceVersion,
		descriptionId: f.description.descriptionId,
		output: { profileId: f.profile.id, target: "file" as const },
		evidence: f.evidence(),
	};
	const result = await playback.plan(input);
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
		playback.plan({ ...input, descriptionId: "stale" }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	const direct = await playback.plan({
		...input,
		evidence: f.evidence(
			Object.fromEntries(f.description.queries.map((q) => [q.id, "supported"])),
		),
	});
	expect(direct).toEqual({
		kind: "playable",
		plan: {
			mode: "direct",
			resource: {
				delivery: "file",
				url: `/api/media/${f.file.id}`,
				mimeType: "video/x-matroska",
				timeline: {
					sourceOriginMs: 0,
					mediaOriginMs: 0,
					sourceDurationMs: null,
				},
			},
		},
	});
	const blocked = await playback.plan({
		...input,
		evidence: f.evidence({ "copy-video": "unknown" }),
	});
	expect(blocked).toEqual({
		kind: "blocked",
		plan: { mode: "blocked", reason: "source-stream-compatibility-unknown" },
	});
	playback.close();
	await expect(playback.plan(input)).rejects.toMatchObject({
		code: "PLAYBACK_UNAVAILABLE",
	});
});

test("playback planning rejects a root change while compatibility is awaited", async () => {
	const f = await fixture();
	const otherRoot = await mkdtemp(join(tmpdir(), "anishelf-planning-other-"));
	cleanup.push(() => rm(otherRoot, { recursive: true, force: true }));
	const original = f.app.check.bind(f.app);
	vi.spyOn(f.app, "check").mockImplementationOnce(async (input) => {
		const checked = await original(input);
		await f.library.updateSettings({ resourceRoot: otherRoot });
		return checked;
	});
	const playback = new PlaybackApplication({
		sources: f.library.sources,
		compatibility: f.app,
		logger: pino({ enabled: false }),
	});
	await expect(
		playback.plan({
			fileId: f.file.id,
			sourceVersion: f.source.identity.sourceVersion,
			descriptionId: f.description.descriptionId,
			output: { profileId: f.profile.id, target: "file" },
			evidence: f.evidence(),
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	playback.close();
});

test("playback resource contracts reject premature URLs and private execution fields", () => {
	expect(Check(PlaybackPlanSchema, { mode: "preparing", taskId: "task" })).toBe(
		true,
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
		expect(
			description.selectedAudioTracks?.map((track) => track.index),
		).toEqual(selection);
		const evidence = description.queries.map((query) => ({
			id: query.id,
			status: "supported" as const,
			reason: "browser-supported" as const,
			smooth: null,
			powerEfficient: null,
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
	const output = { profileId: f.profile.id, target: "hls" as const };
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
			powerEfficient: null,
		}),
	);
	const input = {
		fileId: f.file.id,
		sourceVersion: description.sourceVersion,
		descriptionId: description.descriptionId,
		output,
		evidence,
	};
	const checked = await f.app.check(input);
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
	// Native-file acceptance cannot skip HLS packaging, and the file executor cannot consume HLS.
	expect(
		resolveHlsExecutionPlan({
			...checked,
			direct: { status: "supported", reason: "browser-supported" },
		}).kind,
	).toBe("processing");
	expect(resolveExecutionPlan(checked)).toEqual({
		kind: "blocked",
		reason: "hls-execution-unavailable",
	});
	const playback = new PlaybackApplication({
		sources: f.library.sources,
		compatibility: f.app,
		logger: pino({ enabled: false }),
	});
	const open = vi.spyOn(playback, "open");
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		playback,
	});
	try {
		const response = await http.inject({
			method: "POST",
			url: "/api/playback/plans",
			headers: { host: "127.0.0.1:3000" },
			payload: input,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			kind: "hls-required",
			audioTracks: [{ action: "copy" }, { action: "encode" }],
		});
		expect(response.body).not.toContain(f.source.identity.canonicalRoot);
		expect(response.body).not.toContain("encoder");
		expect(response.body).not.toContain("url");
		expect(open).not.toHaveBeenCalled();
		const stale = await http.inject({
			method: "POST",
			url: "/api/playback/plans",
			headers: { host: "127.0.0.1:3000" },
			payload: { ...input, descriptionId: "a".repeat(64) },
		});
		expect(stale.statusCode).toBe(400);
	} finally {
		await http.close();
	}
});
