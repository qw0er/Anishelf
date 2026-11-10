// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import VideoPlayer from "../../../src/features/playback/player/components/video-player.js";
import * as engine from "../../../src/features/playback/player/movi.js";
import { MockMoviCore, MockMoviElement } from "../../support/mock-movi.js";
import { preparedActive } from "../../support/playback-fixture.js";
import {
	act,
	cleanup,
	render,
	waitFor,
} from "../../support/query-test-utils.js";
import "../../../src/shared/i18n.js";

beforeEach(() => {
	MockMoviElement.instances = [];
	vi.spyOn(engine, "loadPlayer").mockResolvedValue({
		MoviElement: MockMoviElement,
	} as unknown as Awaited<ReturnType<typeof engine.loadPlayer>>);
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		sourceVersion: "v1",
		tracks: [],
		warnings: [],
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
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
const firstAudioStream = preparedActive.asset.audioTracks[0]?.stream;
if (!firstAudioStream) throw new Error("Missing audio fixture");
const twoAudioActive = {
	...preparedActive,
	asset: {
		...preparedActive.asset,
		audioTracks: [
			...preparedActive.asset.audioTracks,
			{
				stream: {
					...firstAudioStream,
					kind: "audio" as const,
					index: 2,
					codec: "aac",
					language: "jpn",
				},
				sourceStreamIndex: 7,
			},
		],
	},
};
async function mounted() {
	await waitFor(() => expect(MockMoviElement.instances).toHaveLength(1));
	const element = MockMoviElement.instances[0];
	if (!element?.player) throw new Error("Missing player fixture");
	await waitFor(() => expect(element.isConnected).toBe(true));
	return { element, core: element.player };
}

test("loads selected bytes and packaged WASM with upstream controls and app-owned history", async () => {
	const onMedia = vi.fn();
	render(<VideoPlayer {...props} onMedia={onMedia} />);
	const { element, core } = await mounted();
	await waitFor(() => expect(onMedia).toHaveBeenCalled());
	expect(element.src).toBe(
		new URL(preparedActive.resource.url, location.origin).href,
	);
	expect(element.hasAttribute("controls")).toBe(true);
	expect(element.hasAttribute("playsinline")).toBe(true);
	expect(element.hasAttribute("resume")).toBe(false);
	expect(element.hasAttribute("autoplay")).toBe(false);
	expect(element.hasAttribute("autoadvance")).toBe(false);
	expect(element.getAttribute("wasmurl")).toBeTruthy();
	expect(element.getAttribute("wasmurl")).not.toMatch(/^https?:/);
	expect(core.activeAudioId).toBe(1);
});

test("title changes preserve the engine and update the accessible region", async () => {
	const view = render(<VideoPlayer {...props} />);
	const { element } = await mounted();
	view.rerender(<VideoPlayer {...props} displayTitle="Corrected title" />);
	expect(view.getByRole("region", { name: "Corrected title" })).toBeTruthy();
	expect(MockMoviElement.instances).toEqual([element]);
});

test("selects non-default audio by numeric ID even when audio languages are identical", async () => {
	render(
		<VideoPlayer
			{...props}
			active={{
				...twoAudioActive,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
		/>,
	);
	const { core } = await mounted();
	await waitFor(() => expect(core.selectAudioTrack).toHaveBeenCalledWith(2));
	expect(core.activeAudioId).toBe(2);
});

test("audio changes preserve the engine and translate selected asset IDs back to source IDs", async () => {
	const onAudioChange = vi.fn();
	const view = render(
		<VideoPlayer
			{...props}
			active={twoAudioActive}
			onAudioChange={onAudioChange}
		/>,
	);
	const { element, core } = await mounted();
	await act(async () => {
		core.activeAudioId = 2;
		element.dispatchEvent(new Event("audiotrackchange"));
	});
	expect(onAudioChange).toHaveBeenLastCalledWith(7);
	view.rerender(
		<VideoPlayer
			{...props}
			active={{
				...twoAudioActive,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
			onAudioChange={onAudioChange}
		/>,
	);
	expect(MockMoviElement.instances).toEqual([element]);
});

test("selecting audio after silence restores the viewer's volume", async () => {
	const view = render(<VideoPlayer {...props} />);
	const { element } = await mounted();
	await act(async () => {
		element.volume = 0.7;
	});
	view.rerender(
		<VideoPlayer {...props} active={{ ...preparedActive, audio: null }} />,
	);
	await waitFor(() => expect(element.volume).toBe(0));
	view.rerender(<VideoPlayer {...props} />);
	await waitFor(() => expect(element.volume).toBe(0.7));
	expect(MockMoviElement.instances).toEqual([element]);
});

test("playback interaction stays inert until the application session finishes restoring", async () => {
	const view = render(<VideoPlayer {...props} playbackReady={false} />);
	const { element } = await mounted();
	expect(element.inert).toBe(true);
	view.rerender(<VideoPlayer {...props} playbackReady />);
	await waitFor(() => expect(element.inert).toBe(false));
});

test("leaves fullscreen requests to the player without changing the app surface", async () => {
	const view = render(<VideoPlayer {...props} />);
	const { element } = await mounted();
	const request = new CustomEvent("movi-fullscreen-request", {
		cancelable: true,
		bubbles: true,
		composed: true,
		detail: { active: false },
	});
	await act(async () => {
		element.dispatchEvent(request);
	});
	expect(request.defaultPrevented).toBe(false);
	expect(element.setHostFullscreen).not.toHaveBeenCalled();
	expect(
		view
			.getByRole("region", { name: "Episode" })
			.hasAttribute("data-viewport-fullscreen"),
	).toBe(false);
});

test("a core replacement detaches the old clock and binds the new generation", async () => {
	const onMedia = vi.fn();
	render(<VideoPlayer {...props} onMedia={onMedia} />);
	const { element, core } = await mounted();
	await waitFor(() => expect(onMedia).toHaveBeenCalled());
	const firstClock = onMedia.mock.calls.at(-1)?.[0];
	await act(async () => {
		element.dispatchEvent(new Event("loadstart"));
		element.player = new MockMoviCore(element);
		element.dispatchEvent(new Event("loadeddata"));
	});
	await waitFor(() => {
		const rebound = onMedia.mock.calls.at(-1)?.[0];
		expect(rebound).toBeTruthy();
		expect(rebound).not.toBe(firstClock);
	});
	expect([...core.listeners.values()].every((set) => set.size === 0)).toBe(
		true,
	);
});

test("unmount clears the source and detaches the clock", async () => {
	const onMedia = vi.fn();
	const view = render(<VideoPlayer {...props} onMedia={onMedia} />);
	const { element, core } = await mounted();
	await waitFor(() => expect(onMedia).toHaveBeenCalled());
	view.unmount();
	expect(onMedia).toHaveBeenLastCalledWith(
		null,
		preparedActive.resource.timeline,
	);
	expect(element.src).toBeNull();
	expect(element.player).toBeNull();
	expect(element.isConnected).toBe(false);
	expect([...core.listeners.values()].every((set) => set.size === 0)).toBe(
		true,
	);
});

test("changing the requested audio selects the same core without reloading media", async () => {
	const view = render(<VideoPlayer {...props} active={twoAudioActive} />);
	const { element, core } = await mounted();
	view.rerender(
		<VideoPlayer
			{...props}
			active={{
				...twoAudioActive,
				audio: { streamIndex: 2, sourceStreamIndex: 7, position: 1 },
			}}
		/>,
	);
	await waitFor(() => expect(core.selectAudioTrack).toHaveBeenCalledWith(2));
	expect(MockMoviElement.instances).toEqual([element]);
});

test("leaving during subtitle discovery prevents a stale player from mounting", async () => {
	let finish!: (value: Awaited<ReturnType<typeof media.getSubtitles>>) => void;
	vi.mocked(media.getSubtitles).mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const onMedia = vi.fn();
	const view = render(<VideoPlayer {...props} onMedia={onMedia} />);
	await waitFor(() => expect(media.getSubtitles).toHaveBeenCalled());
	view.unmount();
	await act(async () => {
		finish({ sourceVersion: "v1", tracks: [], warnings: [] });
	});
	expect(MockMoviElement.instances).toEqual([]);
	expect(onMedia).toHaveBeenLastCalledWith(
		null,
		preparedActive.resource.timeline,
	);
});

test("upstream format errors notify the app even when no runtime error event fires", async () => {
	const onPlaybackFailure = vi.fn();
	render(<VideoPlayer {...props} onPlaybackFailure={onPlaybackFailure} />);
	const { element } = await mounted();
	await act(async () => {
		element.dispatchEvent(
			new CustomEvent("errordisplay", {
				detail: {
					title: "Unsupported format",
					message: "This codec is not supported.",
				},
			}),
		);
	});
	expect(onPlaybackFailure).toHaveBeenCalledWith({
		kind: "unsupported",
		code: null,
	});
});

test("software recovery rebinds a replacement core announced only through statechange", async () => {
	const onMedia = vi.fn();
	render(<VideoPlayer {...props} onMedia={onMedia} />);
	const { element, core } = await mounted();
	await waitFor(() => expect(onMedia.mock.calls.at(-1)?.[0]).toBeTruthy());
	const firstClock = onMedia.mock.calls.at(-1)?.[0];
	await act(async () => {
		element.player = new MockMoviCore(element);
		element.dispatchEvent(new CustomEvent("statechange", { detail: "ready" }));
	});
	await waitFor(() => {
		const replacement = onMedia.mock.calls.at(-1)?.[0];
		expect(replacement).toBeTruthy();
		expect(replacement).not.toBe(firstClock);
	});
	expect([...core.listeners.values()].every((set) => set.size === 0)).toBe(
		true,
	);
});

test("session restoration wins over the opening poster seek after loadeddata", async () => {
	const onMedia = vi.fn();
	render(<VideoPlayer {...props} onMedia={onMedia} />);
	const { element } = await mounted();
	await waitFor(() => expect(onMedia.mock.calls.at(-1)?.[0]).toBeTruthy());
	const replacement = new MockMoviCore(element);
	await act(async () => {
		element.dispatchEvent(new Event("loadstart"));
		element.player = replacement;
		onMedia.mockImplementation((clock) => {
			if (clock) clock.currentTimeMs = 40000;
		});
		element.dispatchEvent(new Event("loadeddata"));
		// Movi starts this opening seek synchronously after dispatching loadeddata.
		await replacement.seek(0);
	});
	await waitFor(() => expect(replacement.seek).toHaveBeenLastCalledWith(40));
	expect(element.currentTime).toBe(40);
});

test("successful recovery clears the application failure without replacing the source", async () => {
	const onPlaybackFailure = vi.fn();
	const onPlaybackRecovered = vi.fn();
	render(
		<VideoPlayer
			{...props}
			onPlaybackFailure={onPlaybackFailure}
			onPlaybackRecovered={onPlaybackRecovered}
		/>,
	);
	const { element, core } = await mounted();
	await act(async () => {
		element.dispatchEvent(
			new CustomEvent("error", { detail: new Error("Decode failed") }),
		);
	});
	expect(onPlaybackFailure).toHaveBeenCalled();
	await act(async () => core.setState("playing"));
	expect(onPlaybackRecovered).toHaveBeenCalledTimes(1);
	expect(MockMoviElement.instances).toEqual([element]);
});
