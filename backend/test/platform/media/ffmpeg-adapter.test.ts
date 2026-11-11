import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { expect, test } from "vitest";
import { MediaInspectionApplication } from "../../../src/modules/media/inspection/application.js";
import { MediaProcessingApplication } from "../../../src/modules/media/preparation/execution/application/processing.js";
import { MediaPlanningApplication } from "../../../src/modules/media/preparation/planning/application/planning.js";
import { LibraryIndex } from "../../../src/modules/resources/library/infrastructure/index.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../../../src/modules/system/configuration/public.js";
import {
	compileFfmpegArguments,
	FfmpegExecutionAdapter,
	type MediaProcessingOptions,
	MediaTools,
} from "../../../src/platform/media/index.js";
import type { MediaProcessingPlan } from "../../../src/platform/media/specification.js";
import { MemoryInspectionStore } from "../../support/inspection-store.js";
import { createLibraryModule } from "../../support/library.js";
import { expectMediaDuration } from "../../support/media.js";
import { settingsStore } from "../../support/settings-store.js";

const run = promisify(execFile);
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

test("real two-audio FFmpeg completes all four processing branches, preserves tracks/copied packets and rejects limits/cancellation", async (context) => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available || !tools.status.ffprobe.available) {
		context.skip();
		return;
	}
	const ffmpeg = tools.status.ffmpeg.path;
	const ffprobe = tools.status.ffprobe.path;
	const root = await mkdtemp(join(tmpdir(), "anishelf-real-execution-"));
	const sourcePath = join(root, "短样本 $(literal).mkv");
	let library: ReturnType<typeof createLibraryModule> | undefined;
	let inspection: MediaInspectionApplication | undefined;
	let processing: MediaProcessingApplication | undefined;
	try {
		await run(
			ffmpeg,
			[
				"-nostdin",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=128x72:rate=12",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=48000",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=880:sample_rate=44100",
				"-map",
				"0:v",
				"-map",
				"1:a",
				"-map",
				"2:a",
				"-metadata:s:a:0",
				"language=eng",
				"-metadata:s:a:0",
				"title=English",
				"-metadata:s:a:1",
				"language=jpn",
				"-metadata:s:a:1",
				"title=Japanese",
				"-disposition:a:0",
				"default",
				"-disposition:a:1",
				"0",
				"-t",
				"1",
				"-c:v",
				"libx264",
				"-profile:v",
				"main",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				sourcePath,
			],
			{ timeout: 30000 },
		);
		const sourceInfo = await tools.probe(sourcePath);
		const index = new LibraryIndex();
		library = createLibraryModule({
			index,
			configuration: settingsStore(root),
			logger: pino({ enabled: false }),
		});
		await library.startScan();
		await library.waitForCompletion();
		const file = [...index.snapshot.entriesById.values()].find(
			(e) => e.kind === "file",
		);
		if (!file) throw new Error("Missing sample");
		const source = await library.sources.resolveSource(file.id);
		inspection = new MediaInspectionApplication({
			repository: new MemoryInspectionStore(),
			sources: library.sources,
			tools,
		});
		const profile = structuredClone(
			builtinTranscodeProfiles.find((p) => p.id === "builtin:balanced"),
		) as TranscodeProfile | undefined;
		if (!profile) throw new Error("Missing profile");
		const compatibility = new MediaPlanningApplication({
			sources: library.sources,
			inspection,
			profiles: [profile],
		});
		const adapter = new FfmpegExecutionAdapter(() =>
			tools.toolStatus("ffmpeg"),
		);
		processing = new MediaProcessingApplication({
			sources: library.sources,
			inspection,
			tools,
			executor: adapter,
			dataDir: root,
		});
		async function compile() {
			if (!file || !profile) throw new Error("Missing source or profile");
			const planned = await compatibility.plan({
				fileId: file?.id,
				sourceVersion: source.identity.sourceVersion,
				profileId: profile?.id,
			});
			if (planned.kind !== "processing-required")
				throw new Error("No processing plan");
			return {
				kind: "processing" as const,
				mode: planned.mode,
				request: {
					...planned.execution,
					maximumBytes: maximumOutputBytes,
				},
			};
		}

		async function packets(path: string) {
			const result = await run(ffprobe, [
				"-v",
				"error",
				"-show_packets",
				"-show_streams",
				"-show_data_hash",
				"sha256",
				"-show_entries",
				"stream=index,codec_type:packet=stream_index,data_hash",
				"-of",
				"json",
				path,
			]);
			const data: {
				streams: { index: number; codec_type: string }[];
				packets: { stream_index: number; data_hash: string }[];
			} = JSON.parse(result.stdout);
			for (const packet of data.packets)
				expect(packet.data_hash).toMatch(/^SHA256:[a-f\d]{64}$/i);
			const hashes = (kind: string) =>
				data.streams
					.filter((stream) => stream.codec_type === kind)
					.map((stream) =>
						data.packets
							.filter((packet) => packet.stream_index === stream.index)
							.map((packet) => packet.data_hash),
					);
			return { video: hashes("video"), audio: hashes("audio") };
		}
		const inputPackets = await packets(sourcePath);
		expect(inputPackets.video).toHaveLength(1);
		expect(inputPackets.video[0]?.length).toBeGreaterThan(0);
		expect(inputPackets.audio).toHaveLength(2);
		for (const track of inputPackets.audio)
			expect(track.length).toBeGreaterThan(0);
		for (const mode of [
			"remux",
			"transcode-audio",
			"transcode-video",
			"transcode",
		] as const) {
			profile.video.filters =
				mode === "transcode" || mode === "transcode-video" ? ["null"] : [];
			profile.audio.filters =
				mode === "transcode" || mode === "transcode-audio" ? ["anull"] : [];
			const result = await compile();
			expect(result).toMatchObject({ kind: "processing", mode });
			if (result.kind !== "processing") throw new Error("No plan");
			const output = await processing.start(result.request).completion;
			expect(output.info.streams.map((stream) => stream.codec)).toEqual([
				"h264",
				"aac",
				"aac",
			]);
			expectMediaDuration(output.info.duration, sourceInfo.duration);
			const outputAudios = output.info.streams.filter(
				(stream) => stream.type === "audio",
			);
			expect(outputAudios.map((stream) => stream.tags.language)).toEqual([
				"eng",
				"jpn",
			]);
			expect(outputAudios.map((stream) => stream.default)).toEqual([
				true,
				false,
			]);
			const copiesVideo = result.request.plan.video.action === "copy";
			const copiesAudio = result.request.plan.audio.action === "copy";
			if (copiesVideo || copiesAudio) {
				const outputPackets = await packets(output.output.path);
				if (copiesVideo) {
					expect(
						output.info.streams.find((stream) => stream.type === "video")
							?.profile,
					).toBe("Main");
					expect(outputPackets.video).toEqual(inputPackets.video);
				}
				if (copiesAudio)
					expect(outputPackets.audio).toEqual(inputPackets.audio);
			}
			if (mode === "transcode") {
				const info = (
					await inspection.inspect(file.id, source.identity.sourceVersion)
				).info;
				await expect(
					adapter.execute(
						sourcePath,
						join(root, "limited"),
						{
							...options(result.request.plan as MediaProcessingPlan),
							videoStreamIndex: result.request.videoStreamIndex,
							audioStreamIndices: result.request.audioStreamIndices,
							maximumBytes: 100,
						},
						info,
					),
				).rejects.toThrow();
				const abort = new AbortController();
				let pid: number | undefined;
				await expect(
					adapter.execute(
						sourcePath,
						join(root, "cancelled"),
						{
							...options(result.request.plan as MediaProcessingPlan),
							videoStreamIndex: result.request.videoStreamIndex,
							audioStreamIndices: result.request.audioStreamIndices,
							signal: abort.signal,
							onEvent(event) {
								if (event.type === "started") {
									pid = event.pid;
									abort.abort();
								}
							},
						},
						info,
					),
				).rejects.toMatchObject({ reason: "cancelled" });
				if (!pid) throw new Error("No child started");
				const closedPid = pid;
				expect(() => process.kill(closedPid, 0)).toThrow();
			}
			if (mode === "remux") {
				const fragmented = await processing.start({
					...result.request,
					plan: {
						...result.request.plan,
						container: "mp4",
						outputFormat: "mp4",
						delivery: "media-source",
					},
				}).completion;
				expect(
					(await readFile(fragmented.output.path)).includes(
						Buffer.from("moof"),
					),
				).toBe(true);
				expect((await packets(fragmented.output.path)).video).toEqual(
					inputPackets.video,
				);
				await processing.release(fragmented.id);
			}
			await processing.release(output.id);
			await expect(stat(output.output.path)).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
		delete profile.video.filters;
		delete profile.audio.filters;
		profile.video.maxHeight = 60;
		profile.audio.channels = 2;
		const resized = await compile();
		if (resized.kind !== "processing") throw new Error("No resized plan");
		const resizedOutput = await processing.start(resized.request).completion;
		expect(
			resizedOutput.info.streams.find((stream) => stream.type === "video"),
		).toMatchObject({ width: 106, height: 60, codecString: "avc1.640033" });
		expect(
			resizedOutput.info.streams
				.filter((stream) => stream.type === "audio")
				.map((stream) => stream.channels),
		).toEqual([2, 2]);
		await processing.release(resizedOutput.id);
		profile.video.filters = ["hqdn3d=1.5:1.5:6:6"];
		profile.video.options = {
			...profile.video.options,
			"x264-params": "aq-mode=3:psy-rd=1.0",
		};
		profile.audio.filters = ["loudnorm=I=-16:TP=-1.5:LRA=11"];
		profile.audio.sampleRate = 48000;
		const advanced = await compile();
		if (advanced.kind !== "processing") throw new Error("No advanced plan");
		const validation = await tools.validateProfiles([profile]);
		expect(validation.validation[profile.id]?.status).toBe("unverified");
		const advancedOutput = await processing.start(advanced.request).completion;
		expect(
			advancedOutput.info.streams.find((s) => s.type === "video")?.height,
		).toBeLessThanOrEqual(60);
		expect(
			advancedOutput.info.streams
				.filter((s) => s.type === "audio")
				.map((s) => ({ channels: s.channels, sampleRate: s.sampleRate })),
		).toEqual([
			{ channels: 2, sampleRate: 48000 },
			{ channels: 2, sampleRate: 48000 },
		]);
		await processing.release(advancedOutput.id);
	} finally {
		await processing?.close();
		await inspection?.close();
		await library?.close();
		await rm(root, { recursive: true, force: true });
	}
}, 60000);
