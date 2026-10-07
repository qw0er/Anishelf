// @vitest-environment happy-dom

import { TextTrack, TextTrackList } from "@vidstack/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import { queryClient } from "../src/api/query-client.js";
import { toast } from "../src/components/ui/toast.js";
import { ChapterTracks } from "../src/features/playback/components/chapter-tracks.js";
import { cleanup, render, waitFor } from "./query-test-utils.js";

let tracks: TextTrackList;
vi.mock("@vidstack/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("@vidstack/react")>()),
	useMediaPlayer: () => ({ textTracks: tracks }),
}));
const timeline = {
	sourceOriginMs: 0,
	mediaOriginMs: 0,
	sourceDurationMs: 10000,
};
beforeEach(() => {
	tracks = new TextTrackList();
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});

test("registers chapters beside subtitles, replaces versions and cleans up only its track", async () => {
	vi.spyOn(api, "getChapters").mockImplementation(
		async (_id, sourceVersion) => ({
			sourceVersion,
			chapters: [{ title: sourceVersion, startMs: 0, endMs: 10000 }],
		}),
	);
	const subtitle = new TextTrack({
		id: "subtitle",
		kind: "subtitles",
		type: "json",
		content: { cues: [] },
	});
	tracks.add(subtitle);
	subtitle.setMode("showing");
	const view = render(
		<ChapterTracks fileId="file" sourceVersion="v1" timeline={timeline} />,
	);
	await waitFor(() =>
		expect(
			tracks.toArray().find((track) => track.kind === "chapters")?.mode,
		).toBe("showing"),
	);
	const first = tracks.toArray().find((track) => track.kind === "chapters");
	await waitFor(() => expect(first?.cues[0]?.text).toBe("v1"));
	expect(subtitle.mode).toBe("showing");
	view.rerender(
		<ChapterTracks fileId="file" sourceVersion="v2" timeline={timeline} />,
	);
	await waitFor(() =>
		expect(
			tracks.toArray().find((track) => track.kind === "chapters")?.id,
		).toBe("chapters:file:v2"),
	);
	expect(tracks.toArray()).not.toContain(first);
	view.unmount();
	expect(tracks.toArray()).toEqual([subtitle]);
});

test("ignores mismatched versions and empty chapters", async () => {
	vi.spyOn(api, "getChapters").mockResolvedValue({
		sourceVersion: "old",
		chapters: [{ title: "Old", startMs: 0, endMs: 1000 }],
	});
	const view = render(
		<ChapterTracks fileId="file" sourceVersion="v1" timeline={timeline} />,
	);
	await waitFor(() =>
		expect(
			queryClient.getQueryData(["chapters", "", "file", "v1"]),
		).toBeDefined(),
	);
	expect(tracks.toArray()).toEqual([]);
	vi.mocked(api.getChapters).mockResolvedValue({
		sourceVersion: "v2",
		chapters: [],
	});
	view.rerender(
		<ChapterTracks fileId="file" sourceVersion="v2" timeline={timeline} />,
	);
	await waitFor(() =>
		expect(
			queryClient.getQueryData(["chapters", "", "file", "v2"]),
		).toBeDefined(),
	);
	expect(tracks.toArray()).toEqual([]);
});

test("reports failed chapter loading with a retry without registering a broken track", async () => {
	vi.spyOn(api, "getChapters")
		.mockRejectedValueOnce(new Error("Failed"))
		.mockResolvedValue({
			sourceVersion: "v1",
			chapters: [{ title: "Opening", startMs: 0, endMs: 1000 }],
		});
	const add = vi.spyOn(toast, "add");
	render(
		<ChapterTracks fileId="file" sourceVersion="v1" timeline={timeline} />,
	);
	await waitFor(() => expect(add).toHaveBeenCalled());
	expect(tracks.toArray()).toEqual([]);
	add.mock.calls[0]?.[0].actionProps?.onClick?.({} as never);
	await waitFor(() => expect(tracks.toArray()).toHaveLength(1));
});
