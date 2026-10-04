import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityEvidence,
} from "../src/contracts/http.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../src/modules/media-compatibility/public.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { resolveExecutionPlan } from "../src/modules/media-processing/public.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { settingsStore } from "./settings-store.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture(audio = true) {
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
				audioStreamIndex: 4,
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
		request: { audioStreamIndex: null },
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
