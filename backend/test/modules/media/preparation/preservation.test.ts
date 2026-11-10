import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
	describeAudio,
	describeVideo,
} from "../../../../src/modules/media/inspection/public.js";
import { validateProcessedMedia } from "../../../../src/modules/media/preparation/execution/domain/validation.js";
import { resolveExecutionPlan } from "../../../../src/modules/media/preparation/planning/domain/execution-plan.js";
import { expectedOutputSpec } from "../../../../src/modules/media/preparation/planning/domain/output-spec.js";
import { builtinTranscodeProfiles } from "../../../../src/modules/system/configuration/public.js";
import {
	FfmpegExecutionAdapter,
	MediaTools,
} from "../../../../src/platform/media/index.js";

const run = promisify(execFile);
test("manual Matroska preparation preserves subtitles, fonts, chapters and dispositions", async () => {
	const root = await mkdtemp(join(tmpdir(), "anishelf-preserve-"));
	const tools = await MediaTools.create();
	expect(tools.status.ffmpeg.available).toBe(true);
	const ffmpeg = tools.status.ffmpeg.available ? tools.status.ffmpeg.path : "";
	try {
		const source = join(root, "source.mkv"),
			output = join(root, "output.mkv"),
			subtitle = join(root, "episode.srt"),
			metadata = join(root, "chapters.ffmeta");
		await writeFile(subtitle, "1\n00:00:00,000 --> 00:00:01,500\nHello\n");
		await writeFile(
			metadata,
			";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Opening\n",
		);
		await run(ffmpeg, [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=160x90:rate=24",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440",
			"-i",
			subtitle,
			"-i",
			metadata,
			"-t",
			"2",
			"-map",
			"0:v",
			"-map",
			"1:a",
			"-map",
			"2:s",
			"-map_chapters",
			"3",
			"-c:v",
			"libx264",
			"-c:a",
			"aac",
			"-c:s",
			"srt",
			"-metadata:s:s:0",
			"language=eng",
			"-disposition:s:0",
			"forced",
			"-attach",
			resolve("test/fixtures/fonts/fixture.ttf"),
			"-metadata:s:t:0",
			"mimetype=application/x-truetype-font",
			"-metadata:s:t:0",
			"filename=fixture.ttf",
			source,
		]);
		const info = await tools.probe(source);
		const video = info.streams.find((s) => s.type === "video");
		const audios = info.streams.filter((s) => s.type === "audio");
		const profile = builtinTranscodeProfiles.find(
			(p) => p.id === "builtin:balanced",
		);
		if (!video || !profile) throw new Error("Missing video/profile fixture");
		const result = resolveExecutionPlan({
			fileId: "file",
			sourceVersion: "v1",
			scopeId: "root",
			profile,
			profileFingerprint: "test",
			selectedVideo: describeVideo(video),
			audioTracks: audios.map((stream) => ({ stream: describeAudio(stream) })),
			selectedAudioStreamIndices: audios.map((s) => s.index),
			defaultAudioStreamIndex: audios[0]?.index ?? null,
		});
		expect(result.kind).toBe("processing");
		if (result.kind !== "processing") throw new Error("No plan");
		await new FfmpegExecutionAdapter(() => tools.toolStatus("ffmpeg"))
			.execute(
				source,
				output,
				{
					plan: result.request.plan,
					videoStreamIndex: result.request.videoStreamIndex,
					audioStreamIndices: [...result.request.audioStreamIndices],
					maximumBytes: 10 * 1024 * 1024,
					timeoutMs: 30000,
				},
				info,
			)
			.catch((error: unknown) => {
				throw new Error(
					String((error as { diagnostic?: string }).diagnostic ?? error),
				);
			});
		const prepared = await tools.probe(output);
		const validate = (actual: typeof info, sourceInfo = info) =>
			validateProcessedMedia(
				actual,
				sourceInfo,
				video,
				audios,
				result.request.plan,
				expectedOutputSpec(
					describeVideo(video),
					audios.map(describeAudio),
					result.request.plan,
				),
				1,
			);
		expect(() => validate(prepared)).not.toThrow();
		expect(() =>
			validate(prepared, {
				...info,
				streams: [...info.streams].sort(
					(a, b) =>
						Number(b.type === "attachment") - Number(a.type === "attachment"),
				),
			}),
		).not.toThrow();
		expect(prepared.streams.filter((s) => s.type === "subtitle")).toMatchObject(
			[
				{
					codec: "subrip",
					forced: true,
					default: false,
					tags: { language: "eng" },
				},
			],
		);
		expect(
			prepared.streams.find((s) => s.type === "attachment")?.tags.filename,
		).toBe("fixture.ttf");
		expect(prepared.chapters[0]?.title).toBe("Opening");
		expect(() =>
			validate({
				...prepared,
				streams: prepared.streams.filter((s) => s.type !== "subtitle"),
			}),
		).toThrow("not preserved");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
