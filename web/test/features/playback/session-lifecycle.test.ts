// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as playbackApi from "../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { ApiClientError } from "../../../src/shared/api/client.js";
import type { PlaybackSessionResponse } from "../../../src/shared/api/contracts.js";

import {
	create,
	deferred,
	session,
	setupTestLifecycle,
	tick,
} from "./support/playback-session-fixture.js";

setupTestLifecycle();

test("loads history before enabling saves and restores after metadata, clamped to duration", async () => {
	const { controller, video, state } = create(false);
	await controller.open();
	video.currentTime = 0;
	video.dispatchEvent(new Event("pause"));
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	Object.defineProperty(video, "duration", { value: 20 });
	video.dispatchEvent(new Event("loadedmetadata"));
	expect(video.currentTime).toBe(20);
	expect(state()?.restored).toBe(true);
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	video.dispatchEvent(new Event("pause"));
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ positionMs: 20000, durationMs: 20000 }),
		expect.anything(),
	);
});

test("failed history reads never save zero and can be retried", async () => {
	vi.mocked(playbackApi.openPlaybackSession).mockRejectedValueOnce(
		new Error("load failed"),
	);
	const { controller, video, state } = create();
	await controller.open();
	video.currentTime = 0;
	video.dispatchEvent(new Event("pause"));
	await controller.flush();
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	expect(state()?.error?.operation).toBe("load");
	await controller.retry();
	expect(video.currentTime).toBe(40);
	expect(state()?.restored).toBe(true);
});

test("saves periodically only while playing; ended saves duration and teardown releases after saving", async () => {
	vi.useFakeTimers();
	const { controller, video } = create();
	await controller.open();
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSaveIntervalMs);
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	Object.defineProperty(video, "paused", { value: false });
	video.currentTime = 45;
	await vi.advanceTimersByTimeAsync(14999);
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	video.currentTime = 99;
	video.dispatchEvent(new Event("ended"));
	await tick();
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.calls.at(-1)?.[1]
			.positionMs,
	).toBe(100000);
	video.currentTime = 100;
	await controller.dispose();
	expect(playbackApi.releasePlaybackSession).toHaveBeenCalledWith(
		"token",
		expect.anything(),
	);
	expect(vi.getTimerCount()).toBe(0);
});

test("unmounting during open releases the late session without writing progress", async () => {
	const pending = deferred<PlaybackSessionResponse>();
	vi.mocked(playbackApi.openPlaybackSession).mockReturnValueOnce(
		pending.promise,
	);
	const { controller } = create();
	const opening = controller.open();
	await tick();
	const disposal = controller.dispose();
	pending.resolve(session);
	await opening;
	await disposal;
	expect(playbackApi.releasePlaybackSession).toHaveBeenCalled();
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
});

test("StrictMode cleanup before open starts avoids creating an abandoned session", async () => {
	const { controller } = create();
	const opening = controller.open();
	await controller.dispose();
	await opening;
	expect(playbackApi.openPlaybackSession).not.toHaveBeenCalled();
});

test("pagehide flushing uses keepalive and still preserves write ordering", async () => {
	const { controller, video } = create();
	await controller.open();
	video.currentTime = 30;
	await controller.flush(true);
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ positionMs: 30000 }),
		expect.objectContaining({ keepalive: true }),
	);
});

test("a changed session requires explicit reopen rather than silently continuing to write", async () => {
	const { controller, video, state } = create();
	await controller.open();
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new ApiClientError({
			kind: "http",
			code: "PLAYBACK_CONFLICT",
			status: 409,
			message: "changed",
		}),
	);
	video.currentTime = 30;
	await controller.flush();
	expect(state()?.error).not.toBeNull();
	vi.mocked(playbackApi.openPlaybackSession).mockResolvedValueOnce({
		...session,
		token: "new-token",
		progress: { ...session.progress, generation: 2, positionMs: 20000 },
	});
	await controller.retry();
	expect(video.currentTime).toBe(20);
	video.currentTime = 25;
	await controller.flush();
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.calls.at(-1)?.[0],
	).toBe("new-token");
});

test("injected save interval and request timeout control the progress lifecycle", async () => {
	vi.useFakeTimers();
	const { controller, video } = create(true, {
		...playbackPolicy,
		progressSaveIntervalMs: 100,
		requestTimeoutMs: 50,
	});
	await controller.open();
	Object.defineProperty(video, "paused", { value: false });
	video.currentTime = 45;
	await vi.advanceTimersByTimeAsync(99);
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	let aborted = false;
	vi.mocked(playbackApi.savePlaybackProgress).mockImplementation(
		(_token, _progress, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => {
					aborted = true;
					reject(new DOMException("Aborted", "AbortError"));
				});
			}),
	);
	video.currentTime = 46;
	const flush = controller.flush();
	await vi.advanceTimersByTimeAsync(49);
	expect(aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	await flush;
	expect(aborted).toBe(true);
	vi.mocked(playbackApi.savePlaybackProgress).mockResolvedValue({
		status: "saved",
		progress: session.progress,
	});
});
