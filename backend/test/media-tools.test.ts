import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseDeploymentConfig } from "../src/modules/configuration/infrastructure/deployment.js";
import { runTool } from "../src/platform/media/process.js";
import { MediaTools, parseMediaInfo } from "../src/platform/media/tools.js";

const tools = await MediaTools.create();
let fixture: string;
beforeAll(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-media-tools-"));
});
afterAll(async () => {
	await rm(fixture, { recursive: true, force: true });
});

test("configures executable overrides independently", () => {
	expect(
		parseDeploymentConfig({ ANISHELF_FFMPEG_PATH: "/opt/tools/ffmpeg" })
			.mediaTools,
	).toEqual({ ffmpegPath: "/opt/tools/ffmpeg", ffprobePath: "ffprobe" });
	expect(
		parseDeploymentConfig({ ANISHELF_FFPROBE_PATH: "/opt/tools/ffprobe" })
			.mediaTools,
	).toEqual({ ffmpegPath: "ffmpeg", ffprobePath: "/opt/tools/ffprobe" });
});

test("normalizes optional metadata and preserves subtitle stream identity", () => {
	const result = parseMediaInfo(
		JSON.stringify({
			format: {
				format_name: "matroska,webm",
				duration: "4.5",
				size: "42",
				bit_rate: "N/A",
			},
			streams: [
				{
					index: 3,
					codec_type: "subtitle",
					codec_name: "ass",
					tags: { language: "eng" },
					disposition: { default: 1, forced: 1 },
				},
			],
		}),
	);
	expect(result).toMatchObject({
		duration: 4.5,
		size: 42,
		bitRate: null,
		streams: [
			{
				index: 3,
				codec: "ass",
				width: null,
				default: true,
				forced: true,
				tags: { language: "eng" },
			},
		],
	});
});

test.each(["not json", "{}", '{"format":{},"streams":[{"index":-1}]}'])(
	"rejects invalid probe output %s",
	(json) => {
		expect(() => parseMediaInfo(json)).toThrow("invalid media information");
	},
);

test("does not silently replace invalid executable overrides", async () => {
	const missing = join(fixture, "missing");
	const unavailable = await MediaTools.create({
		ffmpegPath: missing,
		ffprobePath: missing,
	});
	expect(unavailable.status.ffmpeg.available).toBe(false);
	await expect(
		unavailable.probe(join(fixture, "video.mkv")),
	).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });
	const independent = await MediaTools.create({
		ffmpegPath: missing,
		ffprobePath: "ffprobe",
	});
	expect(independent.status.ffprobe.available).toBe(
		tools.status.ffprobe.available,
	);
});

test("bounds child runtime and output and accepts cancellation", async () => {
	await expect(
		runTool(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
			timeoutMs: 50,
		}),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
	await expect(
		runTool(
			process.execPath,
			["-e", "process.stdout.write('x'.repeat(100000))"],
			{ maxBytes: 100 },
		),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
	await expect(
		runTool(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
			signal: AbortSignal.timeout(50),
		}),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
});

test.skipIf(!tools.status.ffmpeg.available || !tools.status.ffprobe.available)(
	"probes real MKV and extracts SRT/ASS/WebVTT tracks",
	async () => {
		if (!tools.status.ffmpeg.available) throw new Error("FFmpeg unavailable");
		const srt = join(fixture, "source.srt");
		const ass = join(fixture, "source.ass");
		const vtt = join(fixture, "source.vtt");
		const media = join(fixture, "video with spaces ; $.mkv");
		await writeFile(srt, "1\n00:00:00,200 --> 00:00:01,200\nHello SRT\n");
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-i",
			srt,
			ass,
		]);
		await writeFile(
			ass,
			(await readFile(ass, "utf8")).replace("Hello SRT", "{\\i1}Hello SRT"),
		);
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-i",
			srt,
			vtt,
		]);
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=32x32:rate=1:duration=2",
			"-f",
			"lavfi",
			"-i",
			"sine=sample_rate=48000:duration=2",
			"-i",
			srt,
			"-i",
			ass,
			"-i",
			vtt,
			"-map",
			"0:v",
			"-map",
			"1:a",
			"-map",
			"2:s",
			"-map",
			"3:s",
			"-map",
			"4:s",
			"-c:v",
			"ffv1",
			"-c:a",
			"pcm_s16le",
			"-c:s",
			"copy",
			"-metadata:s:s:0",
			"language=eng",
			media,
		]);
		const info = await tools.probe(media);
		expect(info.duration).toBeGreaterThanOrEqual(1.2);
		expect(info.streams[0]).toMatchObject({
			type: "video",
			codec: "ffv1",
			width: 32,
			height: 32,
		});
		expect(info.streams[1]).toMatchObject({
			type: "audio",
			codec: "pcm_s16le",
			sampleRate: 48000,
			channels: 1,
		});
		const subtitles = info.streams.filter(
			(stream) => stream.type === "subtitle",
		);
		expect(subtitles.map((stream) => stream.codec)).toEqual([
			"subrip",
			"ass",
			"webvtt",
		]);
		for (const stream of subtitles) {
			const extracted = await tools.extractSubtitle(media, stream.index);
			expect(extracted.text).toContain("Hello SRT");
			if (stream.codec === "ass") {
				expect(extracted.text).toContain("[V4+ Styles]");
				expect(extracted.text).toContain("{\\i1}");
			}
		}
		const converted = await tools.extractSubtitle(
			media,
			subtitles[0]?.index ?? -1,
			{ format: "webvtt" },
		);
		expect(converted.text).toContain("WEBVTT");
		expect(converted.text).toContain("00:00.200 --> 00:01.200");
		await expect(tools.extractSubtitle(media, 0)).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(tools.extractSubtitle(media, 999)).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(tools.extractSubtitle(media, -1)).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(
			tools.probe("https://example.com/video.mkv"),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await writeFile(join(fixture, "invalid.mkv"), "invalid");
		await expect(
			tools.probe(join(fixture, "invalid.mkv")),
		).rejects.toMatchObject({ code: "TOOL_FAILED" });
	},
	20_000,
);

test("normalizes chapters without rejecting playable media for malformed chapter entries", () => {
	const info = parseMediaInfo(
		JSON.stringify({
			format: { duration: "20" },
			streams: [],
			chapters: [
				{ start_time: "10", end_time: "30", tags: { title: "Part 2" } },
				{ start_time: "-1", end_time: "10" },
				null,
				{ start_time: "invalid", end_time: "5" },
				{ start_time: "5", end_time: "5" },
				{ start_time: "25", end_time: "30" },
			],
		}),
	);
	expect(info.chapters).toEqual([
		{ title: null, startMs: 0, endMs: 10000 },
		{ title: "Part 2", startMs: 10000, endMs: 20000 },
	]);
	expect(
		parseMediaInfo(JSON.stringify({ format: {}, streams: [] })).chapters,
	).toEqual([]);
});

test.skipIf(!tools.status.ffmpeg.available || !tools.status.ffprobe.available)(
	"reads embedded chapters through real FFprobe",
	async () => {
		if (!tools.status.ffmpeg.available) throw new Error("FFmpeg unavailable");
		const metadata = join(fixture, "chapters.ffmeta");
		const media = join(fixture, "chapters.mkv");
		await writeFile(
			metadata,
			";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Opening\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=本編\n",
		);
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=32x32:rate=1:duration=2",
			"-f",
			"ffmetadata",
			"-i",
			metadata,
			"-map",
			"0:v",
			"-map_chapters",
			"1",
			"-c:v",
			"ffv1",
			media,
		]);
		expect((await tools.probe(media)).chapters).toEqual([
			{ title: "Opening", startMs: 0, endMs: 1000 },
			{ title: "本編", startMs: 1000, endMs: 2000 },
		]);
	},
);

test.skipIf(!tools.status.ffmpeg.available || !tools.status.ffprobe.available)(
	"extracts bounded TTF/OTF attachment bytes by absolute stream index",
	async () => {
		if (!tools.status.ffmpeg.available) throw new Error("FFmpeg unavailable");
		const media = join(fixture, "fonts.mkv");
		const ttf = new URL("./fixtures/fonts/fixture.ttf", import.meta.url)
			.pathname;
		const otf = new URL("./fixtures/fonts/fixture.otf", import.meta.url)
			.pathname;
		await runTool(tools.status.ffmpeg.path, [
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=32x32:rate=1:duration=1",
			"-c:v",
			"ffv1",
			"-attach",
			ttf,
			"-metadata:s:t:0",
			"mimetype=font/ttf",
			"-attach",
			otf,
			"-metadata:s:t:1",
			"mimetype=font/otf",
			media,
		]);
		const info = await tools.probe(media);
		const attachments = info.streams.filter(
			(stream) => stream.type === "attachment",
		);
		expect(attachments).toHaveLength(2);
		for (const [index, path] of [ttf, otf].entries()) {
			const stream = attachments[index];
			if (!stream) throw new Error("Missing attachment");
			expect(
				await tools.extractAttachment(media, stream.index, {
					maximumBytes: 1024 * 1024,
				}),
			).toEqual(await readFile(path));
			await expect(
				tools.extractAttachment(media, stream.index, { maximumBytes: 10 }),
			).rejects.toThrow();
		}
		await expect(
			tools.extractAttachment(media, 0, { maximumBytes: 1024 }),
		).rejects.toMatchObject({ code: "INVALID_MEDIA" });
		await expect(
			tools.extractAttachment(media, -1, { maximumBytes: 1024 }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			tools.extractAttachment(media, 1, {
				maximumBytes: 1024,
				signal: AbortSignal.abort(),
			}),
		).rejects.toThrow();
	},
);
