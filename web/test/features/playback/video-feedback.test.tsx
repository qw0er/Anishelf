// @vitest-environment happy-dom

import type AVPlayerUI from "@libmedia/avplayer-ui";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import * as engine from "../../../src/features/playback/player/avplayer.js";
import VideoPlayer from "../../../src/features/playback/player/components/video-player.js";
import { preparedActive } from "../../support/playback-fixture.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "../../support/query-test-utils.js";
import "../../../src/shared/i18n.js";

const load = vi.fn<AVPlayerUI["load"]>(async () => {}),
	destroy = vi.fn(async () => {}),
	select = vi.fn(async () => {}),
	subtitleVisibility = vi.fn(),
	volume = vi.fn();
let listeners: Map<string, Set<(...args: unknown[]) => void>>;
let constructors = 0;
let playerOptions: ConstructorParameters<typeof AVPlayerUI>[0];
class Player {
	constructor(options: ConstructorParameters<typeof AVPlayerUI>[0]) {
		playerOptions = options;
		constructors++;
	}
	on(event: string, fn: (...args: unknown[]) => void) {
		const set = listeners.get(event) ?? new Set();
		set.add(fn);
		listeners.set(event, set);
	}
	off(event: string, fn: (...args: unknown[]) => void) {
		listeners.get(event)?.delete(fn);
	}
	load = load;
	destroy = destroy;
	selectAudio = select;
	setSubtitleEnable = subtitleVisibility;
	setVolume = volume;
	getVolume() {
		return 0.7;
	}
	currentTime = 0n;
	getDuration() {
		return 60000n;
	}
	getPlaybackRate() {
		return 1;
	}
	getStatus() {
		return 6;
	}
	getStreams() {
		return [
			{ index: 1, id: 101, mediaType: "Audio", disposition: 1 },
			{ index: 2, id: 102, mediaType: "Audio", disposition: 0 },
			{ index: 1, id: 200, mediaType: "Subtitle", disposition: 0 },
		];
	}
	getSelectedAudioStreamId() {
		return 101;
	}
}
beforeEach(() => {
	constructors = 0;
	listeners = new Map();
	vi.clearAllMocks();
	vi.spyOn(engine, "loadPlayer").mockResolvedValue(
		Player as unknown as typeof AVPlayerUI,
	);
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		sourceVersion: "v1",
		tracks: [],
		warnings: [],
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
const props = {
	fileId: "file",
	displayTitle: "Episode",
	sourceVersion: "v1",
	active: preparedActive,
};
test("subtitles can be hidden and restored using controls inside the fullscreen surface", async () => {
	const view = render(<VideoPlayer {...props} />);
	const hide = await view.findByRole("button", { name: "Hide subtitles" });
	expect(playerOptions.fullscreenDom?.contains(hide)).toBe(true);
	fireEvent.click(hide);
	expect(subtitleVisibility).toHaveBeenLastCalledWith(false);
	fireEvent.click(view.getByRole("button", { name: "Show subtitles" }));
	expect(subtitleVisibility).toHaveBeenLastCalledWith(true);
	expect(load).toHaveBeenCalledTimes(1);
});
test("enables upstream auto-hide and keeps controls visible outside active playback", async () => {
	const view = render(<VideoPlayer {...props} />);
	await view.findByRole("button", { name: "Hide subtitles" });
	expect(playerOptions.ui).toMatchObject({
		hasFolder: false,
		folderFolded: true,
	});
	const surface = view.getByRole("region", { name: "Episode" });
	expect(surface.getAttribute("data-playing")).toBe("false");
	for (const event of ["paused", "ended", "stopped", "error"]) {
		await act(async () => {
			for (const listener of listeners.get("played") ?? []) listener();
		});
		expect(surface.getAttribute("data-playing")).toBe("true");
		await act(async () => {
			for (const listener of listeners.get(event) ?? []) listener();
		});
		expect(surface.getAttribute("data-playing")).toBe("false");
	}
});
test("hidden subtitles stay hidden after the engine restarts rendering", async () => {
	const view = render(<VideoPlayer {...props} />);
	fireEvent.click(await view.findByRole("button", { name: "Hide subtitles" }));
	for (const event of ["played", "seeked", "changed", "streamUpdate"]) {
		subtitleVisibility.mockClear();
		await act(async () => {
			for (const listener of listeners.get(event) ?? []) listener();
			// Upstream may start rendering synchronously after delivering the event.
			subtitleVisibility(true);
		});
		expect(subtitleVisibility).toHaveBeenLastCalledWith(false);
	}
	expect(view.getByRole("button", { name: "Show subtitles" })).toBeTruthy();
});
test("subtitle controls appear when a track is added to a file without subtitles", async () => {
	const streams = Player.prototype.getStreams;
	const getStreams = vi
		.spyOn(Player.prototype, "getStreams")
		.mockReturnValue([]);
	const onMedia = vi.fn();
	const view = render(<VideoPlayer {...props} onMedia={onMedia} />);
	await waitFor(() => expect(onMedia).toHaveBeenCalled());
	expect(view.queryByRole("button", { name: "Hide subtitles" })).toBeNull();
	getStreams.mockImplementation(streams);
	await act(async () => {
		for (const listener of listeners.get("streamUpdate") ?? []) listener();
	});
	expect(view.getByRole("button", { name: "Hide subtitles" })).toBeTruthy();
});
test("loads selected bytes with same-origin credentials and no compatibility requests", async () => {
	render(<VideoPlayer {...props} />);
	await waitFor(() => expect(load).toHaveBeenCalled());
	expect(load).toHaveBeenCalledWith(
		new URL(preparedActive.resource.url, location.origin).href,
		expect.objectContaining({ http: { credentials: "same-origin" } }),
	);
	expect(select).toHaveBeenCalledWith(101);
});
test("title changes preserve the engine and update the accessible region", async () => {
	const view = render(<VideoPlayer {...props} />);
	await waitFor(() => expect(load).toHaveBeenCalled());
	view.rerender(<VideoPlayer {...props} displayTitle="Corrected title" />);
	expect(view.getByRole("region", { name: "Corrected title" })).toBeTruthy();
	expect(constructors).toBe(1);
});
test("the first play honors an explicitly selected non-default audio track", async () => {
	render(
		<VideoPlayer
			{...props}
			active={{
				...preparedActive,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
		/>,
	);
	await waitFor(() => expect(select).toHaveBeenCalledWith(102));
	const choose = playerOptions.findBestStream;
	if (!choose) throw new Error("Missing initial track selection");
	const streams = [
		{ index: 1, id: 101 },
		{ index: 2, id: 102 },
	] as Parameters<typeof choose>[0];
	expect(choose(streams, 1).index).toBe(2);
});
test("external subtitle indices may overlap audio indices; global stream IDs select the correct type", async () => {
	render(<VideoPlayer {...props} />);
	await waitFor(() => expect(select).toHaveBeenCalledWith(101));
	const choose = playerOptions.findBestStream;
	if (!choose) throw new Error("Missing initial track selection");
	const streams = [
		{ index: 1, id: 101 },
		{ index: 1, id: 200 },
	] as Parameters<typeof choose>[0];
	expect(choose(streams, 3).id).toBe(200);
});
test("audio changes select engine stream IDs without remounting the file", async () => {
	const view = render(<VideoPlayer {...props} />);
	await waitFor(() => expect(select).toHaveBeenCalledWith(101));
	view.rerender(
		<VideoPlayer
			{...props}
			active={{
				...preparedActive,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
		/>,
	);
	await waitFor(() => expect(select).toHaveBeenCalledWith(102));
	expect(load).toHaveBeenCalledTimes(1);
});
test("unmount detaches the clock and destroys the player", async () => {
	const onMedia = vi.fn();
	const view = render(<VideoPlayer {...props} onMedia={onMedia} />);
	await waitFor(() => expect(onMedia).toHaveBeenCalled());
	view.unmount();
	expect(onMedia).toHaveBeenLastCalledWith(
		null,
		preparedActive.resource.timeline,
	);
	expect(destroy).toHaveBeenCalledTimes(1);
});
test("selecting audio after silence restores the previous volume without replacing playback", async () => {
	const view = render(<VideoPlayer {...props} />);
	await waitFor(() => expect(select).toHaveBeenCalledWith(101));
	view.rerender(
		<VideoPlayer {...props} active={{ ...preparedActive, audio: null }} />,
	);
	await waitFor(() => expect(volume).toHaveBeenLastCalledWith(0));
	view.rerender(<VideoPlayer {...props} />);
	await waitFor(() => expect(volume).toHaveBeenLastCalledWith(0.7));
	expect(load).toHaveBeenCalledTimes(1);
});
test("client-side subtitle references contain both source versions", async () => {
	const content = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response("[Script Info]\nScriptType: v4.00+\n"));
	vi.mocked(media.getSubtitles).mockResolvedValue({
		sourceVersion: "v1",
		tracks: [
			{
				id: "sidecar",
				name: "Episode.ass",
				origin: "external",
				format: "ass",
				language: "zh",
				label: null,
				sourceVersion: "sub-v1",
				sizeBytes: 100,
				codec: null,
				default: false,
				forced: false,
				supported: true,
				unsupportedReason: null,
			},
		],
		warnings: [],
	});
	render(<VideoPlayer {...props} />);
	await waitFor(() => expect(load).toHaveBeenCalled());
	const options = load.mock.calls[0]?.[1] as {
		externalSubtitles: { source: File }[];
	};
	expect(content).toHaveBeenCalledWith(
		"/api/files/file/subtitles/sidecar/content?sourceVersion=v1&subtitleVersion=sub-v1",
		expect.objectContaining({ credentials: "same-origin" }),
	);
	expect(options.externalSubtitles[0]?.source.name).toBe("subtitle.ass");
});
