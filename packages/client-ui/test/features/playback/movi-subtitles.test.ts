// @vitest-environment happy-dom

import { originalTimeline } from "@anishelf/contracts/media";
import type { MoviElement } from "movi-player/element";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import {
	assSubtitleCues,
	prepareExternalSubtitles,
} from "../../../src/features/playback/player/subtitles.js";
import type { SubtitleDiscoveryResponse } from "../../../src/shared/api/contracts.js";

const ass = (lines: string[]) => `[Script Info]
ScriptType: v4.00+
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.map((text) => `Dialogue: ${text}`).join("\n")}`;
const line = (text: string, start = "0:00:01.20", end = "0:00:03.40") =>
	`0,${start},${end},Default,,0,0,0,,${text}`;
const ssa = `[Script Info]
ScriptType: v4.00
[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Default,Arial,24,16777215
[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:02.00,0:00:05.00,Default,,0,0,0,,Old SSA`;

function track(
	id: string,
	format: "ass" | "ssa" | "srt" | "vtt" = "ass",
): SubtitleDiscoveryResponse["tracks"][number] {
	return {
		id,
		format,
		origin: "external",
		language: "eng",
		label: "English",
		name: `${id}.${format}`,
		sourceVersion: `subtitle-${id}`,
		sizeBytes: 100,
		codec: null,
		default: false,
		forced: false,
		supported: true,
		unsupportedReason: null,
	};
}
const discovery = (tracks: SubtitleDiscoveryResponse["tracks"]) => ({
	sourceVersion: "video-v1",
	tracks,
	warnings: [],
});
let fetchSubtitle: ReturnType<typeof vi.fn<typeof fetch>>;
let blobs: Blob[];
beforeEach(() => {
	blobs = [];
	fetchSubtitle = vi.fn<typeof fetch>(
		async () => new Response(ass([line("Hello")])),
	);
	vi.stubGlobal("fetch", fetchSubtitle);
	vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		blobs.push(blob as Blob);
		return `blob:subtitle-${blobs.length}`;
	});
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("ASS preserves dialogue, timing, commas and line breaks without tags or drawings", () => {
	const cues = assSubtitleCues(
		ass([
			line("{\\b1}Hello, world{\\b0}\\Nsecond\\nthird\\hword"),
			line("{\\p1}m 0 0 l 10 10{\\p0}"),
			line("backwards", "0:00:04.00", "0:00:03.00"),
			line(""),
		]),
		originalTimeline(),
	);
	expect(cues).toEqual([
		{ start: 1.2, end: 3.4, text: "Hello, world\nsecond\nthird\u00a0word" },
	]);
	expect(assSubtitleCues(ssa, originalTimeline())).toEqual([
		{ start: 2, end: 5, text: "Old SSA" },
	]);
});

test("source-time subtitles are clipped before mapping to the asset timeline", () => {
	expect(
		assSubtitleCues(
			ass([
				line("before", "0:00:00.00", "0:00:01.00"),
				line("overlap", "0:00:01.00", "0:00:03.00"),
				line("tail", "0:00:04.00", "0:00:08.00"),
			]),
			{ sourceOriginMs: 2000, mediaOriginMs: 500, sourceDurationMs: 5000 },
		),
	).toEqual([
		{ start: 0.5, end: 1.5, text: "overlap" },
		{ start: 2.5, end: 3.5, text: "tail" },
	]);
});

test("ASS cue text cannot introduce literal or entity-encoded renderer formatting", () => {
	const contents = ass([
		line('<font color="red" onclick="evil()">raw</font>'),
		line("&lt;font color='blue'&gt;encoded&lt;/font&gt;"),
		line("&amp;lt;b&amp;gt;nested&amp;lt;/b&amp;gt;"),
		line("&#60;i&#62;numeric&#60;/i&#62;"),
	]);
	expect(
		assSubtitleCues(contents, originalTimeline()).map((cue) => cue.text),
	).toEqual(["raw", "encoded", "nested", "numeric"]);
});

test("version-bound content becomes independent same-language tracks without selecting them", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(
		discovery([track("one"), track("two", "ssa"), track("native", "srt")]),
	);
	fetchSubtitle.mockImplementation(
		async (url) =>
			new Response(
				String(url).includes("/native/")
					? "1\r\n00:00:01,000 --> 00:00:02,000\r\nNative\r\n"
					: ass([line("Hello")]),
			),
	);
	const abort = new AbortController();
	const bundle = await prepareExternalSubtitles(
		"file /id",
		"video-v1",
		originalTimeline(),
		abort.signal,
	);
	const element = {
		appendSubtitleCues: vi.fn<MoviElement["appendSubtitleCues"]>(() => true),
		removeSubtitleCues: vi.fn<MoviElement["removeSubtitleCues"]>(() => true),
	};
	bundle.attach(element);
	expect(fetchSubtitle).toHaveBeenCalledWith(
		"/api/files/file%20%2Fid/subtitles/one/content?sourceVersion=video-v1&subtitleVersion=subtitle-one",
		{ credentials: "same-origin", signal: expect.any(AbortSignal) },
	);
	expect(element.appendSubtitleCues.mock.calls.map((call) => call[1])).toEqual([
		{ lang: "external:one", label: "English", select: false },
		{ lang: "external:two", label: "English", select: false },
	]);
	expect(bundle.hasAss).toBe(true);
	expect(bundle.tracks).toHaveLength(1);
	expect(bundle.tracks[0]).toMatchObject({
		src: "blob:subtitle-1",
		srclang: "external:native",
		label: "English",
	});
	expect(bundle.tracks[0]?.dataset.format).toBe("srt");
	expect(await blobs[0]?.text()).not.toContain("\r");
	bundle.dispose();
	bundle.dispose();
	expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
	expect(element.removeSubtitleCues).toHaveBeenCalledWith("external:one");
	expect(element.removeSubtitleCues).toHaveBeenCalledTimes(2);
});

test("a stale video version never fetches or registers sidecar content", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		...discovery([track("one")]),
		sourceVersion: "old-video",
	});
	const bundle = await prepareExternalSubtitles(
		"file",
		"video-v1",
		originalTimeline(),
		new AbortController().signal,
	);
	expect(fetchSubtitle).not.toHaveBeenCalled();
	expect(bundle.tracks).toEqual([]);
	expect(bundle.hasAss).toBe(false);
	bundle.dispose();
});

test("aborting a late content response prevents registrations and blob creation", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(discovery([track("one")]));
	let finish!: (response: Response) => void;
	fetchSubtitle.mockImplementation(
		async () =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	const abort = new AbortController();
	const preparing = prepareExternalSubtitles(
		"file",
		"video-v1",
		originalTimeline(),
		abort.signal,
	);
	await vi.waitFor(() => expect(fetchSubtitle).toHaveBeenCalled());
	abort.abort();
	finish(new Response(ass([line("stale")])));
	const bundle = await preparing;
	const element = { appendSubtitleCues: vi.fn(), removeSubtitleCues: vi.fn() };
	bundle.attach(element);
	expect(element.appendSubtitleCues).not.toHaveBeenCalled();
	expect(URL.createObjectURL).not.toHaveBeenCalled();
	expect(console.warn).not.toHaveBeenCalled();
});

test("one unavailable or malformed sidecar does not discard other tracks", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(
		discovery([track("missing"), track("malformed"), track("valid")]),
	);
	fetchSubtitle.mockImplementation(async (url) =>
		String(url).includes("/missing/")
			? new Response("", { status: 404 })
			: new Response(
					String(url).includes("/malformed/") ? "broken" : ass([line("ok")]),
				),
	);
	const bundle = await prepareExternalSubtitles(
		"file",
		"video-v1",
		originalTimeline(),
		new AbortController().signal,
	);
	const element = { appendSubtitleCues: vi.fn(), removeSubtitleCues: vi.fn() };
	bundle.attach(element);
	expect(element.appendSubtitleCues).toHaveBeenCalledTimes(1);
	expect(console.warn).toHaveBeenCalledTimes(2);
	bundle.dispose();
});

test("native VTT gets supported full timestamps and releases its URL when aborted", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(
		discovery([track("native", "vtt")]),
	);
	fetchSubtitle.mockResolvedValue(
		new Response(
			"WEBVTT\r\n\r\n00:01.000 --> 00:02.500 align:start\r\nText\r\n",
		),
	);
	const abort = new AbortController();
	const bundle = await prepareExternalSubtitles(
		"file",
		"video-v1",
		originalTimeline(),
		abort.signal,
	);
	expect(await blobs[0]?.text()).toBe(
		"WEBVTT\n\n00:00:01.000 --> 00:00:02.500 align:start\nText\n",
	);
	expect(bundle.tracks[0]?.dataset.format).toBe("vtt");
	expect(bundle.hasAss).toBe(false);
	abort.abort();
	expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:subtitle-1");
	bundle.dispose();
	expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});
