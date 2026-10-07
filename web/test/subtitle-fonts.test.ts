// @vitest-environment happy-dom
import { type TextTrack, TextTrackList } from "@vidstack/react";
import { afterEach, expect, test, vi } from "vitest";
import { SubtitleController } from "../src/features/subtitles/controller.js";
import {
	loadFonts,
	type SubtitleFonts,
	trackFonts,
	waitForFonts,
} from "../src/features/subtitles/fonts.js";

const fonts: SubtitleFonts = {
	id: "set",
	status: "ready",
	statusUrl: "/status",
	warnings: [],
	assets: [
		{
			id: "font",
			family: "Fixture",
			format: "ttf",
			sizeBytes: 4,
			contentUrl: "/font",
		},
	],
};
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("loads font bytes and falls back after missing, truncated or oversized responses", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
	vi.stubGlobal("fetch", fetch);
	expect(await loadFonts(fonts, new AbortController().signal)).toEqual({
		bytes: [new Uint8Array([1, 2, 3, 4])],
		degraded: false,
	});
	fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4, 5])));
	expect(await loadFonts(fonts, new AbortController().signal)).toEqual({
		bytes: [],
		degraded: true,
	});
	fetch.mockResolvedValue(new Response(new Uint8Array([1, 2])));
	expect((await loadFonts(fonts, new AbortController().signal)).degraded).toBe(
		true,
	);
	fetch.mockResolvedValue(new Response("missing", { status: 404 }));
	expect((await loadFonts(fonts, new AbortController().signal)).degraded).toBe(
		true,
	);
	expect(await loadFonts(undefined, new AbortController().signal)).toEqual({
		bytes: [],
		degraded: false,
	});
});

test("downloads stop on selection cancellation rather than reporting a font fallback", async () => {
	const controller = new AbortController();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			controller.abort(new Error("selection changed"));
			throw controller.signal.reason;
		}),
	);
	await expect(loadFonts(fonts, controller.signal)).rejects.toThrow(
		"selection changed",
	);
});

test("font polling resolves ready, falls back on errors and stops on cancellation", async () => {
	vi.useFakeTimers();
	const fetch = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(fonts), {
			headers: { "content-type": "application/json" },
		}),
	);
	vi.stubGlobal("fetch", fetch);
	const waiting = waitForFonts(
		{ ...fonts, status: "pending" },
		new AbortController().signal,
	);
	await vi.advanceTimersByTimeAsync(500);
	expect(await waiting).toEqual(fonts);
	fetch.mockRejectedValue(new Error("network"));
	const failed = waitForFonts(
		{ ...fonts, status: "pending" },
		new AbortController().signal,
	);
	await vi.advanceTimersByTimeAsync(500);
	expect((await failed).status).toBe("degraded");
	const controller = new AbortController();
	const cancelled = waitForFonts(
		{ ...fonts, status: "pending" },
		controller.signal,
	);
	const assertion = expect(cancelled).rejects.toThrow("stop");
	controller.abort(new Error("stop"));
	await assertion;
});

test("degraded fonts keep the selected ASS enabled, preserve metadata and allow retry", async () => {
	const tracks = new TextTrackList();
	const prepare = vi.fn().mockResolvedValue({
		id: "asset",
		status: "ready",
		format: "ass",
		errorCode: null,
		contentUrl: "/subtitle",
		statusUrl: null,
		fonts: {
			...fonts,
			status: "degraded",
			warnings: ["FONT_EXTRACTION_FAILED"],
		},
	});
	const feedback = vi.fn();
	const controller = new SubtitleController(
		tracks,
		[
			{
				id: "track",
				origin: "embedded",
				name: "ASS",
				format: "ass",
				language: null,
				label: null,
				sizeBytes: null,
				sourceVersion: "v1",
				codec: "ass",
				default: true,
				forced: false,
				supported: true,
				unsupportedReason: null,
			},
		],
		prepare,
		feedback,
	);
	const initial = tracks.getById("track");
	if (!initial) throw new Error("Missing track");
	initial.mode = "showing";
	await vi.waitFor(() => expect(tracks.selected?.src).toBe("/subtitle"));
	expect(trackFonts.get(tracks.selected as TextTrack)?.status).toBe("degraded");
	expect(feedback).toHaveBeenLastCalledWith({
		status: "warning",
		name: "ASS",
		errorCode: "FONT_FALLBACK",
	});
	controller.retry();
	await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
	controller.dispose();
});
