// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import VideoPlayer from "../src/features/playback/player/components/video-player.js";
import * as resourcesApi from "../src/features/resources/resource-access/api.js";
import { toast } from "../src/shared/components/ui/toast.js";
import { preparedActive, required } from "./playback-fixture.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "./query-test-utils.js";

const playerEvents = vi.hoisted(() => ({
	setup: undefined as
		| undefined
		| ((provider: { video: HTMLVideoElement }) => void),
	metadata: undefined as undefined | (() => void),
}));
vi.mock("@vidstack/react", () => ({
	VideoProviderLoader: class {},
	isVideoProvider: (provider: { video?: HTMLVideoElement }) =>
		Boolean(provider.video),
	MediaPlayer: ({
		onError,
		onProviderSetup,
		onLoadedMetadata,
	}: {
		onError(): void;
		onProviderSetup(provider: { video: HTMLVideoElement }): void;
		onLoadedMetadata(): void;
	}) => {
		playerEvents.setup = onProviderSetup;
		playerEvents.metadata = onLoadedMetadata;
		return (
			<button type="button" onClick={onError}>
				Fail playback
			</button>
		);
	},
	MediaProvider: () => null,
}));
vi.mock("@vidstack/react/player/layouts/default", () => ({
	DefaultVideoLayout: () => null,
	defaultLayoutIcons: {},
}));
vi.mock("../src/features/playback/player/components/chapter-tracks.js", () => ({
	ChapterTracks: () => null,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
test("copy failures report one scoped Toast without re-querying original metadata", async () => {
	const get = vi.spyOn(resourcesApi, "getFile");
	const add = vi.spyOn(toast, "add").mockReturnValue("notice");
	const close = vi.spyOn(toast, "close").mockImplementation(() => {});
	const failure = vi.fn();
	const view = render(
		<VideoPlayer
			fileId="file"
			displayTitle="Episode"
			active={preparedActive}
			sourceVersion="v1"
			onPlaybackFailure={failure}
		/>,
	);
	fireEvent.click(view.getByRole("button"));
	await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
	expect(add).toHaveBeenCalledWith(
		expect.objectContaining({
			id: "video-playback:file",
			title: "player.failures.unknown",
		}),
	);
	expect(get).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button"));
	expect(add).toHaveBeenCalledTimes(1);
	expect(failure).toHaveBeenCalledWith({ kind: "unknown", code: null });
	close.mockClear();
	view.unmount();
	expect(close).not.toHaveBeenCalledWith("video-playback:file");
});
test("a known video with no decoded picture reports a decode failure for that asset", async () => {
	const failure = vi.fn();
	vi.spyOn(toast, "add").mockReturnValue("notice");
	render(
		<VideoPlayer
			fileId="file"
			displayTitle="Episode"
			active={preparedActive}
			sourceVersion="v1"
			onPlaybackFailure={failure}
		/>,
	);
	const video = document.createElement("video");
	Object.defineProperty(video, "videoWidth", { value: 0, configurable: true });
	Object.defineProperty(video, "videoHeight", { value: 0, configurable: true });
	act(() => {
		playerEvents.setup?.({ video });
		playerEvents.metadata?.();
	});
	expect(failure).toHaveBeenCalledWith({ kind: "decode", code: 3 });
});
test("native audio selection uses output position and maps changes back to the source track", () => {
	const changed = vi.fn();
	const active = {
		...preparedActive,
		asset: {
			...preparedActive.asset,
			audioTracks: [
				{
					...required(preparedActive.asset.audioTracks[0]),
					sourceStreamIndex: 7,
				},
				{
					...required(preparedActive.asset.audioTracks[0]),
					stream: {
						...required(preparedActive.asset.audioTracks[0]).stream,
						index: 2,
					},
					sourceStreamIndex: 9,
				},
			],
		},
		audio: { streamIndex: 2, sourceStreamIndex: 9, position: 1 },
	};
	render(
		<VideoPlayer
			fileId="file"
			displayTitle="Episode"
			active={active}
			sourceVersion="v1"
			onAudioChange={changed}
		/>,
	);
	const video = document.createElement("video");
	Object.defineProperty(video, "videoWidth", { value: 1920 });
	Object.defineProperty(video, "videoHeight", { value: 1080 });
	const tracks = Object.assign(new EventTarget(), {
		0: { enabled: true },
		1: { enabled: false },
		length: 2,
	});
	Object.defineProperty(video, "audioTracks", { value: tracks });
	act(() => {
		playerEvents.setup?.({ video });
		playerEvents.metadata?.();
	});
	expect(tracks[0].enabled).toBe(false);
	expect(tracks[1].enabled).toBe(true);
	act(() => {
		tracks[1].enabled = false;
		tracks[0].enabled = true;
		tracks.dispatchEvent(new Event("change"));
	});
	expect(changed).toHaveBeenCalledWith(7);
});
