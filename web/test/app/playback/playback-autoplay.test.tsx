// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import * as api from "../../../src/features/playback/player/api.js";
import { usePlaybackSession } from "../../../src/features/playback/player/hooks/use-playback-session.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import type { PlaybackSessionResponse } from "../../../src/shared/api/contracts.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import "../../../src/shared/i18n.js";
import {
	act,
	cleanup,
	renderHook,
	waitFor,
} from "../../support/query-test-utils.js";

const session: PlaybackSessionResponse = {
	token: "next-session",
	sourceVersion: "next-version",
	file: {
		id: "next-file",
		kind: "file",
		parentId: "root",
		name: "Next.mp4",
		sizeBytes: 1,
		modifiedAt: "date",
		mimeType: "video/mp4",
	},
	progress: {
		positionMs: 40000,
		durationMs: 100000,
		generation: 1,
		lastSequence: 0,
		lastViewedAtMs: 1,
	},
};
afterEach(async () => {
	await act(async () => {
		cleanup();
		for (let index = 0; index < 20; index++) await Promise.resolve();
	});
	vi.restoreAllMocks();
});

test.each([false, true])(
	"continuation starts after restoring the next file's progress (browser rejects: %s)",
	async (blocked) => {
		let resolveSession: ((value: PlaybackSessionResponse) => void) | undefined;
		vi.spyOn(api, "openPlaybackSession").mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSession = resolve;
				}),
		);
		vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
		vi.spyOn(api, "savePlaybackProgress").mockResolvedValue({
			status: "saved",
			progress: session.progress,
		});
		const notification = vi.spyOn(toast, "add");
		const video = document.createElement("video");
		Object.defineProperty(video, "readyState", { value: 1 });
		Object.defineProperty(video, "duration", { value: 100 });
		const play = vi.spyOn(video, "play").mockImplementation(async () => {
			expect(video.currentTime).toBe(40);
			if (blocked)
				throw new DOMException("Autoplay blocked", "NotAllowedError");
		});
		const { result } = renderHook(() =>
			usePlaybackSession("next-file", playbackPolicy, true),
		);
		act(() => result.current.attach(video));
		expect(play).not.toHaveBeenCalled();
		await waitFor(() => expect(resolveSession).toBeDefined());
		await act(async () => {
			resolveSession?.(session);
		});
		await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
		if (blocked)
			expect(notification).toHaveBeenCalledWith(
				expect.objectContaining({
					title:
						"Press Play to continue. Your browser could not start playback automatically.",
				}),
			);
		else expect(notification).not.toHaveBeenCalled();
		expect(video.currentTime).toBe(40);
	},
);

test("ordinary player openings restore progress without automatic playback", async () => {
	vi.spyOn(api, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
	vi.spyOn(api, "savePlaybackProgress").mockResolvedValue({
		status: "saved",
		progress: session.progress,
	});
	const video = document.createElement("video");
	Object.defineProperty(video, "readyState", { value: 1 });
	Object.defineProperty(video, "duration", { value: 100 });
	const play = vi.spyOn(video, "play").mockResolvedValue();
	const { result } = renderHook(() =>
		usePlaybackSession("next-file", playbackPolicy),
	);
	act(() => result.current.attach(video));
	await waitFor(() => expect(video.currentTime).toBe(40));
	expect(play).not.toHaveBeenCalled();
});

test("a late autoplay rejection after navigation does not notify the next screen", async () => {
	vi.spyOn(api, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
	vi.spyOn(api, "savePlaybackProgress").mockResolvedValue({
		status: "saved",
		progress: session.progress,
	});
	const notification = vi.spyOn(toast, "add");
	const video = document.createElement("video");
	Object.defineProperty(video, "readyState", { value: 1 });
	Object.defineProperty(video, "duration", { value: 100 });
	let rejectPlay: (() => void) | undefined;
	const play = vi.spyOn(video, "play").mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectPlay = () =>
					reject(new DOMException("Blocked", "NotAllowedError"));
			}),
	);
	const hook = renderHook(() =>
		usePlaybackSession("next-file", playbackPolicy, true),
	);
	act(() => hook.result.current.attach(video));
	await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	await act(async () => {
		hook.unmount();
		rejectPlay?.();
	});
	expect(notification).not.toHaveBeenCalled();
});
