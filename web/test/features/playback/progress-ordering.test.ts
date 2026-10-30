// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as playbackApi from "../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";

import {
	create,
	deferred,
	session,
	setupTestLifecycle,
	tick,
} from "./support/playback-session-fixture.js";

setupTestLifecycle();

test("serializes/coalesces saves while preserving a newer backward seek", async () => {
	const { controller, video } = create();
	await controller.open();
	const first =
		deferred<Awaited<ReturnType<typeof playbackApi.savePlaybackProgress>>>();
	vi.mocked(playbackApi.savePlaybackProgress).mockImplementationOnce(
		() => first.promise,
	);
	video.currentTime = 70;
	video.dispatchEvent(new Event("pause"));
	video.currentTime = 80;
	video.dispatchEvent(new Event("seeked"));
	video.currentTime = 10;
	video.dispatchEvent(new Event("seeked"));
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	first.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 70000, lastSequence: 1 },
	});
	await controller.flush();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(2);
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.calls[1]?.[1],
	).toMatchObject({
		positionMs: 10000,
		sequence: 2,
	});
});

test("keeps an ambiguous failed payload for retry, or sends a newer position", async () => {
	const { controller, video, state } = create();
	await controller.open();
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new Error("network"),
	);
	video.currentTime = 30;
	expect(await controller.flush()).toBe(false);
	const failed = vi.mocked(playbackApi.savePlaybackProgress).mock.calls[0]?.[1];
	expect(state()?.error?.operation).toBe("save");
	await controller.retry();
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.calls[1]?.[1],
	).toEqual(failed);
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new Error("network"),
	);
	video.currentTime = 50;
	await controller.flush();
	video.currentTime = 10;
	await controller.retry();
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.calls.at(-1)?.[1]
			.positionMs,
	).toBe(10000);
});

test("seeking to zero saves normally without pausing or changing generation", async () => {
	vi.useFakeTimers();
	const { controller, video } = create();
	await controller.open();
	const pause = vi.spyOn(video, "pause");
	video.currentTime = 0;
	video.dispatchEvent(new Event("seeked"));
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSeekDelayMs);
	expect(pause).not.toHaveBeenCalled();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ generation: 1, sequence: 1, positionMs: 0 }),
		expect.anything(),
	);
	video.currentTime = 3;
	video.dispatchEvent(new Event("seeked"));
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSeekDelayMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ generation: 1, sequence: 2, positionMs: 3000 }),
		expect.anything(),
	);
});

test("rapid seeks coalesce and pausing flushes immediately without duplicate writes", async () => {
	vi.useFakeTimers();
	const { controller, video } = create();
	await controller.open();
	for (const position of [50, 20, 0]) {
		video.currentTime = position;
		video.dispatchEvent(new Event("seeked"));
		await vi.advanceTimersByTimeAsync(100);
	}
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	video.dispatchEvent(new Event("pause"));
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 0 }),
		expect.anything(),
	);
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSeekDelayMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
});

test("an unchanged snapshot is not queued again while its save is in flight", async () => {
	const { controller, video } = create();
	await controller.open();
	const first =
		deferred<Awaited<ReturnType<typeof playbackApi.savePlaybackProgress>>>();
	vi.mocked(playbackApi.savePlaybackProgress).mockReturnValueOnce(
		first.promise,
	);
	video.currentTime = 60;
	video.dispatchEvent(new Event("pause"));
	video.dispatchEvent(new Event("pause"));
	const flush = controller.flush();
	first.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 60000, lastSequence: 1 },
	});
	await flush;
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
});
