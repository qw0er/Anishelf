// @vitest-environment happy-dom

import { originalTimeline } from "@anishelf/contracts/media";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import { prepareExternalSubtitles } from "../../../src/features/playback/player/subtitles.js";
import type { SubtitleDiscoveryResponse } from "../../../src/shared/api/contracts.js";

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
beforeEach(() => {
	fetchSubtitle = vi.fn<typeof fetch>(async () => new Response("fixture"));
	vi.stubGlobal("fetch", fetchSubtitle);
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("version-bound sidecars retain their format, styles and source timing on the selected asset", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(
		discovery([
			track("one"),
			track("two", "ssa"),
			track("srt", "srt"),
			track("vtt", "vtt"),
		]),
	);
	const tracks = await prepareExternalSubtitles(
		"file /id",
		"video-v1",
		{ sourceOriginMs: 2000, mediaOriginMs: 500, sourceDurationMs: 5000 },
		new AbortController().signal,
	);
	expect(fetchSubtitle).toHaveBeenCalledWith(
		"/api/files/file%20%2Fid/subtitles/one/content?sourceVersion=video-v1&subtitleVersion=subtitle-one",
		{ credentials: "same-origin", signal: expect.any(AbortSignal) },
	);
	expect(tracks.map(({ format, renderer }) => [format, renderer])).toEqual([
		["ass", "styled"],
		["ssa", "styled"],
		["srt", undefined],
		["vtt", undefined],
	]);
	expect(
		tracks.every((item) => item.offsetMs === -1500 && item.language === "eng"),
	).toBe(true);
	expect(new Set(tracks.map((item) => item.content)).size).toBe(4);
	expect(await tracks[0]?.content?.text()).toBe("fixture");
});

test("a stale video version never fetches content", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		...discovery([track("one")]),
		sourceVersion: "previous",
	});
	expect(
		await prepareExternalSubtitles(
			"file",
			"video-v1",
			originalTimeline(),
			new AbortController().signal,
		),
	).toEqual([]);
	expect(fetchSubtitle).not.toHaveBeenCalled();
});

test("aborting a late subtitle fetch discards its response", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(discovery([track("one")]));
	let finish: ((response: Response) => void) | undefined;
	fetchSubtitle.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const abort = new AbortController();
	const pending = prepareExternalSubtitles(
		"file",
		"video-v1",
		originalTimeline(),
		abort.signal,
	);
	await vi.waitFor(() => expect(finish).toBeDefined());
	abort.abort();
	finish?.(new Response("stale"));
	expect(await pending).toEqual([]);
	expect(console.warn).not.toHaveBeenCalled();
});

test("a missing sidecar does not prevent other tracks from loading", async () => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue(
		discovery([track("missing"), track("valid")]),
	);
	fetchSubtitle.mockImplementation(async (url) =>
		String(url).includes("/missing/")
			? new Response(null, { status: 404 })
			: new Response("style"),
	);
	expect(
		await prepareExternalSubtitles(
			"file",
			"video-v1",
			originalTimeline(),
			new AbortController().signal,
		),
	).toHaveLength(1);
	expect(console.warn).toHaveBeenCalledTimes(1);
});
