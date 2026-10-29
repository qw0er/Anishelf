import * as playbackApi from "../src/features/playback/player/api.js";
import { ApiClientError } from "../src/shared/api/client.js";
// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { playbackPolicy } from "../src/features/playback/player/policy.js";
import {
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../src/features/playback/player/session.js";
import type { PlaybackSessionResponse } from "../src/shared/api/contracts.js";

const session: PlaybackSessionResponse = {
	token: "token",
	sourceVersion: "version",
	file: {
		kind: "file",
		id: "file",
		parentId: "root",
		name: "Video.mp4",
		sizeBytes: 100,
		modifiedAt: "date",
		mimeType: "video/mp4",
	},
	progress: {
		positionMs: 40000,
		durationMs: 100000,
		lastViewedAtMs: 1,
		generation: 1,
		lastSequence: 0,
	},
};
let controllers: PlaybackSessionController[];
beforeEach(() => {
	controllers = [];
	vi.spyOn(playbackApi, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(playbackApi, "savePlaybackProgress").mockImplementation(
		async (_token, input) => ({
			status: "saved",
			progress: {
				...session.progress,
				...input,
				lastSequence: input.sequence,
			},
		}),
	);
	vi.spyOn(playbackApi, "releasePlaybackSession").mockResolvedValue();
});
afterEach(async () => {
	for (const controller of controllers) await controller.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function create(ready = true, policy = playbackPolicy) {
	let state: PlaybackSessionState | null = null;
	const controller = new PlaybackSessionController(
		"file",
		(next) => {
			state = next;
		},
		policy,
	);
	controllers.push(controller);
	const video = document.createElement("video");
	Object.defineProperty(video, "duration", { value: 100, configurable: true });
	Object.defineProperty(video, "readyState", {
		value: ready ? 1 : 0,
		configurable: true,
	});
	controller.attach(video);
	return { controller, video, state: () => state };
}
async function tick() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

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
