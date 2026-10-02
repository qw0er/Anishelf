// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { TextTrack } from "@vidstack/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { SubtitleDiscoveryResponse } from "../src/api/contracts.js";
import { useExternalSubtitles } from "../src/hooks/use-external-subtitles.js";
import { StyledSubtitleRenderer } from "../src/subtitles/renderer.js";
import { clientConfig } from "./client-config.js";

const plainTrack: SubtitleDiscoveryResponse["tracks"][number] = {
	id: "sub-1",
	name: "episode.en.srt",
	format: "srt",
	label: "en",
	language: "en",
	sizeBytes: 10,
	sourceVersion: "subtitle-version",
};
const discovery: SubtitleDiscoveryResponse = {
	sourceVersion: "video-version",
	warnings: [],
	tracks: [
		{
			id: "sub-1",
			name: "episode.en.srt",
			format: "srt",
			label: "en",
			language: "en",
			sizeBytes: 10,
			sourceVersion: "subtitle-version",
		},
		{
			id: "sub-2",
			name: "episode.ass",
			format: "ass",
			label: null,
			language: null,
			sizeBytes: 10,
			sourceVersion: "styled-version",
		},
	],
};
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("discovers metadata without requesting subtitle content", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => json(discovery));
	vi.stubGlobal("fetch", fetcher);
	const { result } = renderHook(() => useExternalSubtitles("file-1"), {
		wrapper: StrictMode,
	});
	await waitFor(() => expect(result.current?.tracks.length).toBe(2));
	expect(
		fetcher.mock.calls.every(([url]) => url === "/api/files/file-1/subtitles"),
	).toBe(true);
});

test("ignores stale discovery and aborts pending requests", async () => {
	let resolve: (response: Response) => void = () => {};
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		)
		.mockImplementation(async () => json(discovery));
	vi.stubGlobal("fetch", fetcher);
	const { result, rerender, unmount } = renderHook(
		({ id }) => useExternalSubtitles(id),
		{ initialProps: { id: "first" } },
	);
	const signal = fetcher.mock.lastCall?.[1]?.signal;
	rerender({ id: "second" });
	await waitFor(() => expect(result.current?.tracks.length).toBe(2));
	expect(signal?.aborted).toBe(true);
	await act(async () => {
		resolve(json({ ...discovery, tracks: [] }));
	});
	expect(result.current?.tracks.length).toBe(2);
	const lastSignal = fetcher.mock.lastCall?.[1]?.signal;
	unmount();
	expect(lastSignal?.aborted).toBe(true);
});

test("refreshes discovery when the player remounts", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => json(discovery));
	vi.stubGlobal("fetch", fetcher);
	const first = renderHook(() => useExternalSubtitles("file-1"));
	await waitFor(() => expect(first.result.current?.tracks.length).toBe(2));
	first.unmount();
	fetcher.mockImplementation(async () => json({ ...discovery, tracks: [] }));
	const next = renderHook(() => useExternalSubtitles("file-1"));
	await waitFor(() => expect(next.result.current?.tracks).toEqual([]));
});

test("Vidstack parses real SRT/VTT timing", async () => {
	for (const format of ["srt", "vtt"] as const) {
		const track = new TextTrack({
			id: plainTrack.id,
			label: plainTrack.name,
			kind: "subtitles",
			type: format,
			content:
				format === "srt"
					? "1\n00:00:01,200 --> 00:00:02,400\n你好\n"
					: "WEBVTT\n\n00:01.200 --> 00:02.400\n你好\n",
		});
		await waitFor(() => expect(track.readyState).toBe(2));
		expect(track.cues[0]).toMatchObject({
			startTime: 1.2,
			endTime: 2.4,
			text: "你好",
		});
	}
});

test("styled adapter only handles ASS/SSA tracks and safely detaches", () => {
	const renderer = new StyledSubtitleRenderer(clientConfig.subtitles);
	const video = document.createElement("video");
	const track = (type: "vtt" | "srt" | "ass" | "ssa") =>
		new TextTrack({
			label: type,
			kind: "subtitles",
			type,
			src: "/subtitle/content",
		});
	expect(renderer.canRender(track("vtt"), video)).toBe(false);
	expect(renderer.canRender(track("srt"), video)).toBe(false);
	expect(renderer.canRender(track("ass"), video)).toBe(true);
	expect(renderer.canRender(track("ssa"), null)).toBe(false);
	renderer.attach(video);
	renderer.changeTrack(null);
	renderer.detach();
});
