// @vitest-environment happy-dom
import { type TextTrack, TextTrackList } from "@vidstack/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../src/api/contracts.js";
import { SubtitleController } from "../src/features/subtitles/controller.js";
import { SubtitlePreparationError } from "../src/features/subtitles/errors.js";
import { prepareSelectedSubtitle } from "../src/features/subtitles/preparation.js";

type SubtitleTrack = SubtitleDiscoveryResponse["tracks"][number];
const descriptor = (id: string): SubtitleTrack => ({
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
	supported: true,
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
	const controller = new SubtitleController(
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

test("switching between unified external and embedded choices cancels stale preparation", async () => {
	const tracks = new TextTrackList();
	let complete!: (value: SubtitlePreparationResponse) => void;
	const prepare = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<SubtitlePreparationResponse>((resolve) => {
					complete = resolve;
				}),
		)
		.mockResolvedValueOnce({
			...ready,
			id: "external",
			statusUrl: null,
			contentUrl: "/external/content",
		});
	const controller = new SubtitleController(
		tracks,
		[
			descriptor("first"),
			{
				...descriptor("external"),
				origin: "external",
				codec: null,
				default: false,
				sizeBytes: 12,
				sourceVersion: "external-version",
			},
		],
		prepare,
		vi.fn(),
	);
	expect(prepare).not.toHaveBeenCalled();
	getTrack(tracks, "first").mode = "showing";
	const signal = prepare.mock.calls[0]?.[1] as AbortSignal;
	getTrack(tracks, "external").mode = "showing";
	expect(signal.aborted).toBe(true);
	await vi.waitFor(() =>
		expect(tracks.selected?.src).toBe("/external/content"),
	);
	expect(prepare.mock.calls[1]?.[2]).toBe("external-version");
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
		.mockRejectedValueOnce(
			new SubtitlePreparationError("SUBTITLE_TOOL_UNAVAILABLE"),
		)
		.mockImplementationOnce(() => new Promise(() => {}));
	const feedback = vi.fn();
	const controller = new SubtitleController(
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
	const controller = new SubtitleController(
		tracks,
		[
			{
				...descriptor("bitmap"),
				supported: false,
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
		"v1",
		new AbortController().signal,
	);
	expect(result).toEqual(ready);
	expect(fetcher.mock.calls[0]?.[0]).toBe(
		"/api/files/file%201/subtitles/track%202/prepare",
	);
	expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
		method: "POST",
		body: JSON.stringify({ sourceVersion: "v1", subtitleVersion: "v1" }),
	});
	expect(fetcher.mock.calls[1]?.[0]).toBe(ready.statusUrl);
});

test("external ready preparation completes without polling", async () => {
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
		new Response(
			JSON.stringify({
				...ready,
				statusUrl: null,
				contentUrl: "/external/content",
			}),
		),
	);
	vi.stubGlobal("fetch", fetcher);
	const result = await prepareSelectedSubtitle(
		"file",
		"external",
		"video-version",
		"subtitle-version",
		new AbortController().signal,
	);
	expect(result.contentUrl).toBe("/external/content");
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
		JSON.stringify({
			sourceVersion: "video-version",
			subtitleVersion: "subtitle-version",
		}),
	);
});

test("unexpected diagnostic messages are not interpreted as subtitle error codes", async () => {
	const tracks = new TextTrackList();
	const feedback = vi.fn();
	const controller = new SubtitleController(
		tracks,
		[descriptor("first")],
		async () => {
			throw new Error("SUBTITLE_TOOL_UNAVAILABLE");
		},
		feedback,
	);
	getTrack(tracks, "first").mode = "showing";
	await vi.waitFor(() =>
		expect(feedback).toHaveBeenLastCalledWith({
			status: "failed",
			name: "first",
			errorCode: "SUBTITLE_EXTRACTION_FAILED",
		}),
	);
	controller.dispose();
});
