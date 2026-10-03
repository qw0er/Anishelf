// @vitest-environment happy-dom
import { TextTrack, TextTrackList } from "@vidstack/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../src/api/contracts.js";
import { EmbeddedSubtitleController } from "../src/features/subtitles/embedded.js";
import { prepareSelectedSubtitle } from "../src/features/subtitles/preparation.js";

type Embedded = Extract<
	SubtitleDiscoveryResponse["tracks"][number],
	{ origin: "embedded" }
>;
const descriptor = (id: string): Embedded => ({
	id,
	origin: "embedded",
	name: id,
	format: "srt",
	language: "en",
	label: null,
	sizeBytes: null,
	sourceVersion: "v1",
	codec: "subrip",
	default: true,
	forced: false,
	extractionSupported: true,
	webSupported: true,
	unsupportedReason: null,
});
const ready: SubtitlePreparationResponse = {
	id: "asset-1",
	status: "ready",
	format: "srt",
	errorCode: null,
	contentUrl: "/api/subtitle-assets/asset-1",
	statusUrl: "/api/subtitle-assets/asset-1/status",
};
function getTrack(tracks: TextTrackList, id: string): TextTrack {
	const track = tracks.getById(id);
	if (!track) throw new Error("Missing track");
	return track;
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("registers CC options without preparation, then replaces only the selected placeholder", async () => {
	const tracks = new TextTrackList();
	const prepare = vi.fn().mockResolvedValue(ready);
	const feedback = vi.fn();
	const controller = new EmbeddedSubtitleController(
		tracks,
		[descriptor("first"), descriptor("second")],
		prepare,
		feedback,
	);
	expect(prepare).not.toHaveBeenCalled();
	expect(tracks.getById("first")?.src).toBeUndefined();
	expect(tracks.selected).toBeNull();
	const selected = tracks.getById("first");
	if (!selected) throw new Error("Missing track");
	selected.mode = "showing";
	await vi.waitFor(() => expect(tracks.selected?.src).toBe(ready.contentUrl));
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(prepare.mock.calls[0]?.[0]).toBe("first");
	expect(tracks.getById("second")?.src).toBeUndefined();
	getTrack(tracks, "first").mode = "disabled";
	getTrack(tracks, "first").mode = "showing";
	expect(prepare).toHaveBeenCalledTimes(1);
	controller.dispose();
	expect(tracks.length).toBe(0);
});

test("switching to external subtitles aborts preparation and ignores its late result", async () => {
	const tracks = new TextTrackList();
	let complete!: (value: SubtitlePreparationResponse) => void;
	const prepare = vi.fn(
		(_id: string, _signal: AbortSignal) =>
			new Promise<SubtitlePreparationResponse>((resolve) => {
				complete = resolve;
			}),
	);
	const controller = new EmbeddedSubtitleController(
		tracks,
		[descriptor("first")],
		prepare,
		vi.fn(),
	);
	const external = new TextTrack({
		id: "external",
		kind: "subtitles",
		content: { cues: [] },
		type: "json",
	});
	tracks.add(external);
	getTrack(tracks, "first").mode = "showing";
	const signal = prepare.mock.calls[0]?.[1];
	external.mode = "showing";
	expect(signal?.aborted).toBe(true);
	complete(ready);
	await Promise.resolve();
	expect(tracks.selected?.id).toBe("external");
	expect(tracks.getById("first")?.src).toBeUndefined();
	controller.dispose();
});

test("failure keeps the choice retryable and disposing aborts the new request", async () => {
	const tracks = new TextTrackList();
	const prepare = vi
		.fn()
		.mockRejectedValueOnce(new Error("SUBTITLE_TOOL_UNAVAILABLE"))
		.mockImplementationOnce(() => new Promise(() => {}));
	const feedback = vi.fn();
	const controller = new EmbeddedSubtitleController(
		tracks,
		[descriptor("first")],
		prepare,
		feedback,
	);
	getTrack(tracks, "first").mode = "showing";
	await vi.waitFor(() =>
		expect(feedback).toHaveBeenLastCalledWith({
			status: "failed",
			name: "first",
			errorCode: "SUBTITLE_TOOL_UNAVAILABLE",
		}),
	);
	controller.retry();
	expect(prepare).toHaveBeenCalledTimes(2);
	const signal = prepare.mock.calls[1]?.[1] as AbortSignal;
	controller.dispose();
	expect(signal.aborted).toBe(true);
});

test("unsupported bitmap descriptors never trigger preparation", () => {
	const tracks = new TextTrackList();
	const prepare = vi.fn();
	const controller = new EmbeddedSubtitleController(
		tracks,
		[
			{
				...descriptor("bitmap"),
				webSupported: false,
				extractionSupported: false,
				format: null,
			},
		],
		prepare,
		vi.fn(),
	);
	expect(tracks.length).toBe(0);
	expect(prepare).not.toHaveBeenCalled();
	controller.dispose();
});

test("preparation client sends a version-bound POST and polls pending status", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ ...ready, status: "pending", contentUrl: null }),
				{ status: 202 },
			),
		)
		.mockResolvedValueOnce(
			new Response(JSON.stringify(ready), { status: 200 }),
		);
	vi.stubGlobal("fetch", fetcher);
	const result = await prepareSelectedSubtitle(
		"file 1",
		"track 2",
		"v1",
		new AbortController().signal,
	);
	expect(result).toEqual(ready);
	expect(fetcher.mock.calls[0]?.[0]).toBe(
		"/api/files/file%201/subtitles/track%202/prepare",
	);
	expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
		method: "POST",
		body: JSON.stringify({ sourceVersion: "v1" }),
	});
	expect(fetcher.mock.calls[1]?.[0]).toBe(ready.statusUrl);
});
