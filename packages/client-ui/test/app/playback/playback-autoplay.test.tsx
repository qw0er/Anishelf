// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as media from "../../../src/features/media/subtitles/api.js";
import * as api from "../../../src/features/playback/player/api.js";
import VideoPlayer from "../../../src/features/playback/player/components/video-player.js";
import { usePlaybackSession } from "../../../src/features/playback/player/hooks/use-playback-session.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { session } from "../../features/playback/support/playback-session-fixture.js";
import { mockPlayer } from "../../support/mock-libmedia.js";
import { preparedActive } from "../../support/playback-fixture.js";
import {
	act,
	cleanup,
	render,
	waitFor,
} from "../../support/query-test-utils.js";
import "../../../src/shared/i18n.js";

function Harness({ autoPlay = true }: { autoPlay?: boolean }) {
	const playback = usePlaybackSession("file", playbackPolicy, autoPlay);
	if (!playback.session) return null;
	return (
		<VideoPlayer
			fileId="file"
			displayTitle="Next"
			active={preparedActive}
			sourceVersion={session.sourceVersion}
			silent={false}
			bind={playback.bind}
			startContinuation={playback.startContinuation}
			onAudioChange={() => {}}
			onPlaybackFailure={() => {}}
			onPlaybackRecovered={() => {}}
			onReselect={() => {}}
		/>
	);
}
beforeEach(() => {
	vi.spyOn(media, "getSubtitles").mockResolvedValue({
		sourceVersion: session.sourceVersion,
		tracks: [],
		warnings: [],
	});
	vi.spyOn(api, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
	vi.spyOn(api, "savePlaybackProgress").mockResolvedValue({
		status: "saved",
		progress: session.progress,
	});
	mockPlayer.restored = true;
	mockPlayer.play.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
	await act(async () => cleanup());
	vi.restoreAllMocks();
});

test.each([false, true])(
	"starts the continuation only after restoration (blocked: %s)",
	async (blocked) => {
		const notification = vi.spyOn(toast, "add");
		mockPlayer.play.mockImplementationOnce(async () => {
			expect(mockPlayer.instances[0]?.video.currentTime).toBe(40);
			if (blocked)
				throw new DOMException("Autoplay blocked", "NotAllowedError");
		});
		const view = render(<Harness />);
		expect(mockPlayer.play).not.toHaveBeenCalled();
		await view.findByLabelText("Video: Next");
		await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
		if (blocked)
			expect(notification).toHaveBeenCalledWith(
				expect.objectContaining({ id: "continuation-play:file" }),
			);
		else expect(notification).not.toHaveBeenCalled();
	},
);

test("ordinary openings restore without automatically starting", async () => {
	const view = render(<Harness autoPlay={false} />);
	await view.findByLabelText("Video: Next");
	await waitFor(() =>
		expect(mockPlayer.instances[0]?.video.currentTime).toBe(40),
	);
	expect(mockPlayer.play).not.toHaveBeenCalled();
});

test("a late autoplay rejection after unmount does not notify the next screen", async () => {
	const notification = vi.spyOn(toast, "add");
	let rejectPlay: (() => void) | undefined;
	mockPlayer.play.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				rejectPlay = () =>
					reject(new DOMException("Autoplay blocked", "NotAllowedError"));
			}),
	);
	const view = render(<Harness />);
	await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
	await act(async () => {
		view.unmount();
		rejectPlay?.();
	});
	expect(notification).not.toHaveBeenCalled();
});
