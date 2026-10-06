// @vitest-environment happy-dom

import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "../src/components/ui/toast.js";
import { subtitlePolicy } from "../src/config/media-policy.js";
import VideoPlayer from "../src/features/playback/components/video-player.js";

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
vi.mock("../src/features/subtitles/components/subtitle-tracks.js", () => ({
	SubtitleTracks: () => null,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/api/client.js", () => ({
	getFile: vi.fn(async () => ({})),
	isRequestCancelled: () => false,
	ApiClientError: class extends Error {},
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("playback errors use one Toast and preserve it through resource reselection", async () => {
	const add = vi.spyOn(toast, "add").mockReturnValue("video-playback:file-1");
	const close = vi.spyOn(toast, "close").mockImplementation(() => {});
	const { getByRole, queryByRole, unmount } = render(
		<VideoPlayer
			file={{
				id: "file-1",
				kind: "file",
				parentId: "root",
				name: "episode.mp4",
				sizeBytes: 1,
				modifiedAt: "2026-10-03T00:00:00Z",
				mimeType: "video/mp4",
			}}
			playbackUrl="/api/media/file-1"
			subtitlePolicy={subtitlePolicy}
		/>,
	);
	fireEvent.click(getByRole("button"));
	await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
	expect(add).toHaveBeenCalledWith(
		expect.objectContaining({
			id: "video-playback:file-1",
			type: "error",
			title: "errors.mediaPlayback",
		}),
	);
	expect(queryByRole("alert")).toBeNull();
	fireEvent.click(getByRole("button"));
	await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
	close.mockClear();
	unmount();
	expect(close).not.toHaveBeenCalledWith("video-playback:file-1");
});

test("known video sources without a decoded picture report failure even when audio plays", async () => {
	const failure = vi.fn();
	const add = vi.spyOn(toast, "add").mockReturnValue("notice");
	render(
		<VideoPlayer
			file={{
				id: "file-2",
				kind: "file",
				parentId: "root",
				name: "Audio only.mkv",
				sizeBytes: 1,
				modifiedAt: "date",
				mimeType: "video/x-matroska",
			}}
			playbackUrl="/api/media/file-2"
			subtitlePolicy={subtitlePolicy}
			expectsVideo
			onPlaybackFailure={failure}
		/>,
	);
	const video = document.createElement("video");
	Object.defineProperty(video, "videoWidth", { value: 0 });
	Object.defineProperty(video, "videoHeight", { value: 0 });
	act(() => {
		playerEvents.setup?.({ video });
		playerEvents.metadata?.();
	});
	await waitFor(() =>
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "errors.mediaPictureUnavailable" }),
		),
	);
	expect(failure).toHaveBeenCalledTimes(1);
});
