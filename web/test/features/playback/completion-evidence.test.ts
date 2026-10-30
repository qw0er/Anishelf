// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as playbackApi from "../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { ApiClientError } from "../../../src/shared/api/client.js";

import {
	create,
	setupTestLifecycle,
	tick,
} from "./support/playback-session-fixture.js";

setupTestLifecycle();

test("counts normal wall time and excludes forward seeks", async () => {
	vi.useFakeTimers();
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const { controller, video } = create();
	await controller.open();
	video.dispatchEvent(new Event("playing"));
	now = 1000;
	video.currentTime = 41;
	video.dispatchEvent(new Event("timeupdate"));
	video.dispatchEvent(new Event("seeking"));
	video.currentTime = 99;
	video.dispatchEvent(new Event("seeked"));
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSeekDelayMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({
			positionMs: 99000,
			normalPlayedMs: 1000,
		}),
		expect.anything(),
	);
	video.dispatchEvent(new Event("playing"));
	now = 2000;
	video.currentTime = 100;
	video.dispatchEvent(new Event("pause"));
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressSeekDelayMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({
			normalPlayedMs: 2000,
		}),
		expect.anything(),
	);
});

test("retains cumulative normal time when a response is lost and a newer payload is queued", async () => {
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const { controller, video } = create();
	await controller.open();
	let reject: (error: Error) => void = () => {};
	vi.mocked(playbackApi.savePlaybackProgress).mockImplementationOnce(
		() =>
			new Promise((_resolve, no) => {
				reject = no;
			}),
	);
	video.dispatchEvent(new Event("playing"));
	now = 1000;
	video.currentTime = 41;
	video.dispatchEvent(new Event("pause"));
	await tick();
	video.dispatchEvent(new Event("playing"));
	now = 2000;
	video.currentTime = 42;
	video.dispatchEvent(new Event("pause"));
	reject(new Error("Lost response"));
	await tick();
	await controller.retry();
	const payload = vi
		.mocked(playbackApi.savePlaybackProgress)
		.mock.calls.at(-1)?.[1];
	expect(payload?.normalPlayedMs).toBe(2000);
});

test("a natural end updates pending telemetry even when the position is unchanged after an ambiguous failure", async () => {
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const { controller, video } = create();
	Object.defineProperty(video, "duration", {
		value: Number.NaN,
		configurable: true,
	});
	await controller.open();
	video.dispatchEvent(new Event("playing"));
	for (let i = 1; i <= 30; i++) {
		now = i * 1000;
		video.currentTime = 40 + i;
		video.dispatchEvent(new Event("timeupdate"));
	}
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new Error("Lost response"),
	);
	video.dispatchEvent(new Event("pause"));
	await tick();
	const failed = vi
		.mocked(playbackApi.savePlaybackProgress)
		.mock.calls.at(-1)?.[1];
	expect(failed).toMatchObject({
		positionMs: 70000,
		normalPlayedMs: 30000,
		naturalEnd: false,
		durationMs: null,
	});
	video.dispatchEvent(new Event("ended"));
	await controller.retry();
	const retried = vi
		.mocked(playbackApi.savePlaybackProgress)
		.mock.calls.at(-1)?.[1];
	expect(retried).toMatchObject({
		positionMs: 70000,
		normalPlayedMs: 30000,
		naturalEnd: true,
		durationMs: null,
	});
	expect(retried?.sequence).toBeGreaterThan(failed?.sequence ?? 0);
});

test("normal playback evidence and natural end survive an outage until the automatic retry", async () => {
	vi.useFakeTimers();
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const { controller, video } = create();
	await controller.open();
	vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
		new ApiClientError({ kind: "network", message: "lost response" }),
	);
	video.dispatchEvent(new Event("playing"));
	for (let i = 1; i <= 10; i++) {
		now = i * 1000;
		video.currentTime = 40 + i;
		video.dispatchEvent(new Event("timeupdate"));
	}
	await controller.flush();
	for (let i = 11; i <= 30; i++) {
		now = i * 1000;
		video.currentTime = 40 + i;
		video.dispatchEvent(new Event("timeupdate"));
	}
	video.currentTime = 100;
	Object.defineProperty(video, "ended", { value: true });
	video.dispatchEvent(new Event("ended"));
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressRetryInitialMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({
			positionMs: 100000,
			normalPlayedMs: 30000,
			naturalEnd: true,
		}),
		expect.anything(),
	);
});
