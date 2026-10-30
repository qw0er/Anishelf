// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as playbackApi from "../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { ApiClientError } from "../../../src/shared/api/client.js";

import {
	create,
	session,
	setupTestLifecycle,
	tick,
} from "./support/playback-session-fixture.js";

setupTestLifecycle();

test("switching to prepared media retains the original session and captured source-time position", async () => {
	const { controller, video } = create();
	await controller.open();
	video.currentTime = 61;
	controller.attach(null);
	const preparedVideo = document.createElement("video");
	Object.defineProperty(preparedVideo, "readyState", { value: 1 });
	Object.defineProperty(preparedVideo, "duration", { value: 100 });
	controller.attach(preparedVideo);
	expect(preparedVideo.currentTime).toBe(61);
	preparedVideo.currentTime = 65;
	preparedVideo.dispatchEvent(new Event("pause"));
	await controller.flush();
	expect(playbackApi.openPlaybackSession).toHaveBeenCalledTimes(1);
	expect(playbackApi.openPlaybackSession).toHaveBeenCalledWith(
		"file",
		expect.anything(),
	);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		session.token,
		expect.objectContaining({
			generation: session.progress.generation,
			sourceVersion: session.sourceVersion,
			positionMs: 65000,
		}),
		expect.anything(),
	);
});

test("offset media restores and persists source time rather than the local segment clock", async () => {
	const { controller, video } = create();
	controller.attach(video, {
		sourceOriginMs: 30000,
		mediaOriginMs: 2000,
		sourceDurationMs: 200000,
	});
	await controller.open();
	expect(video.currentTime).toBe(12);
	video.currentTime = 17;
	await controller.flush();
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 45000, durationMs: 200000 }),
		expect.anything(),
	);
});

test("an offset stream ending does not mark the whole source watched", async () => {
	const { controller, video } = create();
	controller.attach(video, {
		sourceOriginMs: 30000,
		mediaOriginMs: 0,
		sourceDurationMs: 200000,
	});
	await controller.open();
	video.dispatchEvent(new Event("ended"));
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 130000, durationMs: 200000 }),
		expect.anything(),
	);
});

test("switching assets during a save outage restores the captured source position and retries", async () => {
	vi.useFakeTimers();
	const { controller, video, state } = create();
	await controller.open();
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new ApiClientError({ kind: "network", message: "offline" }),
	);
	video.currentTime = 61;
	await controller.flush();
	controller.attach(null);
	const prepared = document.createElement("video");
	Object.defineProperty(prepared, "readyState", { value: 1 });
	Object.defineProperty(prepared, "duration", { value: 100 });
	controller.attach(prepared);
	expect(prepared.currentTime).toBe(61);
	expect(state()?.restored).toBe(true);
	prepared.currentTime = 65;
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressRetryInitialMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 65000 }),
		expect.anything(),
	);
	expect(playbackApi.openPlaybackSession).toHaveBeenCalledTimes(1);
});
