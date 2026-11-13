// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as playbackApi from "../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../src/features/playback/player/policy.js";
import { ApiClientError } from "../../../src/shared/api/client.js";

import {
	create,
	deferred,
	session,
	setupTestLifecycle,
	tick,
} from "./support/playback-session-fixture.js";

setupTestLifecycle();

test.each([408, 429, 500, 503])(
	"HTTP %i retries an unchanged ambiguous write automatically",
	async (status) => {
		vi.useFakeTimers();
		const { controller, video, state } = create();
		await controller.open();
		vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValueOnce(
			new ApiClientError({ kind: "http", status, message: "temporary" }),
		);
		video.currentTime = 30;
		expect(await controller.flush()).toBe(false);
		const failed = vi.mocked(playbackApi.savePlaybackProgress).mock
			.calls[0]?.[1];
		await vi.advanceTimersByTimeAsync(
			playbackPolicy.progressRetryInitialMs - 1,
		);
		expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(2);
		expect(
			vi.mocked(playbackApi.savePlaybackProgress).mock.calls[1]?.[1],
		).toEqual(failed);
		expect(state()?.error).toBeNull();
	},
);

test("failed saves back off to a bounded delay while events retain the latest backward seek", async () => {
	vi.useFakeTimers();
	const { controller, video, state } = create();
	await controller.open();
	const save = vi.mocked(playbackApi.savePlaybackProgress);
	const success = save.getMockImplementation();
	save.mockRejectedValue(
		new ApiClientError({ kind: "network", message: "offline" }),
	);
	video.currentTime = 70;
	await controller.flush();
	const errorStates: unknown[] = [];
	for (const [index, delay] of [
		5000, 10000, 20000, 40000, 60000, 60000,
	].entries()) {
		video.currentTime = 60 - index * 5;
		video.dispatchEvent(new Event("pause"));
		await vi.advanceTimersByTimeAsync(delay - 1);
		expect(save).toHaveBeenCalledTimes(index + 1);
		errorStates.push(state()?.error);
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledTimes(index + 2);
	}
	expect(errorStates.every(Boolean)).toBe(true);
	if (!success) throw new Error("Missing save implementation");
	save.mockImplementation(success);
	video.currentTime = 0;
	video.dispatchEvent(new Event("seeked"));
	await vi.advanceTimersByTimeAsync(60000);
	expect(save).toHaveBeenCalledTimes(8);
	expect(save).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 0 }),
		expect.anything(),
	);
	expect(state()?.error).toBeNull();
	video.currentTime = 10;
	save.mockRejectedValueOnce(
		new ApiClientError({ kind: "network", message: "again" }),
	);
	await controller.flush();
	await vi.advanceTimersByTimeAsync(5000);
	expect(save).toHaveBeenCalledTimes(10);
});

test.each([400, 401, 403, 404, 409, 422])(
	"HTTP %i is not automatically retried by timers, online, pagehide or disposal",
	async (status) => {
		vi.useFakeTimers();
		const { controller, video } = create();
		await controller.open();
		vi.mocked(playbackApi.savePlaybackProgress).mockRejectedValue(
			new ApiClientError({
				kind: "http",
				status,
				message: "permanent",
				...(status === 409 ? { code: "PLAYBACK_CONFLICT" } : {}),
			}),
		);
		video.currentTime = 60;
		await controller.flush();
		video.currentTime = 50;
		video.dispatchEvent(new Event("pause"));
		controller.reconnect();
		await controller.flush(true);
		await vi.advanceTimersByTimeAsync(120000);
		await controller.dispose();
		expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
		expect(playbackApi.openPlaybackSession).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	},
);

test("a timed out save retries automatically and keeps its error until success", async () => {
	vi.useFakeTimers();
	const { controller, video, state } = create(true, {
		...playbackPolicy,
		requestTimeoutMs: 50,
	});
	await controller.open();
	vi.mocked(playbackApi.savePlaybackProgress).mockImplementationOnce(
		(_token, _payload, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () =>
					reject(new DOMException("Timed out", "AbortError")),
				);
			}),
	);
	video.currentTime = 60;
	const flush = controller.flush();
	await vi.advanceTimersByTimeAsync(50);
	expect(await flush).toBe(false);
	expect(state()?.error?.operation).toBe("save");
	const retry =
		deferred<Awaited<ReturnType<typeof playbackApi.savePlaybackProgress>>>();
	vi.mocked(playbackApi.savePlaybackProgress).mockReturnValueOnce(
		retry.promise,
	);
	video.currentTime = 20;
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressRetryInitialMs);
	expect(state()?.error?.operation).toBe("save");
	expect(state()?.saving).toBe(true);
	retry.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 20000, lastSequence: 2 },
	});
	await tick();
	expect(state()?.error).toBeNull();
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 20000 }),
		expect.anything(),
	);
});

test("known offline state suppresses requests and reconnect saves the latest progress", async () => {
	vi.useFakeTimers();
	const online = vi.spyOn(navigator, "onLine", "get");
	const { controller, video, state } = create();
	await controller.open();
	online.mockReturnValue(false);
	video.currentTime = 70;
	expect(await controller.flush()).toBe(false);
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressRetryInitialMs);
	expect(playbackApi.savePlaybackProgress).not.toHaveBeenCalled();
	video.currentTime = 0;
	video.dispatchEvent(new Event("pause"));
	online.mockReturnValue(true);
	controller.reconnect();
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 0 }),
		expect.anything(),
	);
	expect(state()?.error).toBeNull();
	await vi.advanceTimersByTimeAsync(playbackPolicy.progressRetryMaximumMs);
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
});

test("disposal retries a transient in-flight failure with the final position before release", async () => {
	vi.useFakeTimers();
	const { controller, video } = create();
	await controller.open();
	let fail: (cause: unknown) => void = () => {};
	vi.mocked(playbackApi.savePlaybackProgress).mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				fail = reject;
			}),
	);
	video.currentTime = 60;
	video.dispatchEvent(new Event("pause"));
	video.currentTime = 10;
	const disposal = controller.dispose();
	fail(new ApiClientError({ kind: "network", message: "lost response" }));
	await disposal;
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(2);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 10000 }),
		expect.anything(),
	);
	expect(playbackApi.releasePlaybackSession).toHaveBeenCalledTimes(1);
	expect(
		vi.mocked(playbackApi.savePlaybackProgress).mock.invocationCallOrder[1],
	).toBeLessThan(
		vi.mocked(playbackApi.releasePlaybackSession).mock.invocationCallOrder[0] ??
			0,
	);
	expect(vi.getTimerCount()).toBe(0);
});

test("losing connectivity during an in-flight save defers the newer snapshot", async () => {
	vi.useFakeTimers();
	const online = vi.spyOn(navigator, "onLine", "get");
	const { controller, video, state } = create();
	await controller.open();
	const first =
		deferred<Awaited<ReturnType<typeof playbackApi.savePlaybackProgress>>>();
	vi.mocked(playbackApi.savePlaybackProgress).mockReturnValueOnce(
		first.promise,
	);
	video.currentTime = 60;
	video.dispatchEvent(new Event("pause"));
	online.mockReturnValue(false);
	video.currentTime = 10;
	video.dispatchEvent(new Event("pause"));
	first.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 60000, lastSequence: 1 },
	});
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(1);
	expect(state()?.error?.operation).toBe("save");
	online.mockReturnValue(true);
	controller.reconnect();
	await tick();
	expect(playbackApi.savePlaybackProgress).toHaveBeenCalledTimes(2);
	expect(playbackApi.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ positionMs: 10000 }),
		expect.anything(),
	);
});

test("a response slower than five seconds succeeds within the relaxed timeout", async () => {
	vi.useFakeTimers();
	const { controller, video, state } = create();
	await controller.open();
	const delayed =
		deferred<Awaited<ReturnType<typeof playbackApi.savePlaybackProgress>>>();
	vi.mocked(playbackApi.savePlaybackProgress).mockReturnValueOnce(
		delayed.promise,
	);
	video.currentTime = 60;
	const flush = controller.flush();
	await vi.advanceTimersByTimeAsync(10000);
	const signal = vi.mocked(playbackApi.savePlaybackProgress).mock.calls[0]?.[2]
		?.signal;
	expect(signal?.aborted).toBe(false);
	expect(state()?.error).toBeNull();
	delayed.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 60000, lastSequence: 1 },
	});
	expect(await flush).toBe(true);
});
