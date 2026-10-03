// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "../src/components/ui/toast.js";
import VideoPlayer from "../src/features/playback/components/video-player.js";
import { clientConfig } from "./client-config.js";

vi.mock("@vidstack/react", () => ({
	VideoProviderLoader: class {},
	isVideoProvider: () => false,
	MediaPlayer: ({ onError }: { onError(): void }) => (
		<button type="button" onClick={onError}>
			Fail playback
		</button>
	),
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

test("playback errors use one Toast and retry remount closes the notification", async () => {
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
			subtitlePolicy={clientConfig.subtitles}
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
	expect(close).toHaveBeenCalledWith("video-playback:file-1");
});
