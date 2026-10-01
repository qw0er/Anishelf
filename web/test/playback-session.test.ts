// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type { PlaybackSessionResponse } from "../src/api/contracts.js";
import {
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../src/playback/session.js";

const session: PlaybackSessionResponse = {
	token: "token",
	generation: 1,
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
	plan: { mode: "direct", playbackUrl: "/api/media/file" },
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
	vi.spyOn(api, "openPlaybackSession").mockResolvedValue(session);
	vi.spyOn(api, "savePlaybackProgress").mockImplementation(
		async (_token, input) => ({
			status: "saved",
			progress: {
				...session.progress,
				...input,
				lastSequence: input.sequence,
			},
		}),
	);
	vi.spyOn(api, "releasePlaybackSession").mockResolvedValue();
});
afterEach(async () => {
	for (const controller of controllers) await controller.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function create(ready = true) {
	let state: PlaybackSessionState | null = null;
	const controller = new PlaybackSessionController("file", (next) => {
		state = next;
	});
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
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
	Object.defineProperty(video, "duration", { value: 20 });
	video.dispatchEvent(new Event("loadedmetadata"));
	expect(video.currentTime).toBe(20);
	expect(state()?.restored).toBe(true);
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
	video.dispatchEvent(new Event("pause"));
	await tick();
	expect(api.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ positionMs: 20000, durationMs: 20000 }),
		expect.anything(),
	);
});

test("serializes/coalesces saves while preserving a newer backward seek", async () => {
	const { controller, video } = create();
	await controller.open();
	const first =
		deferred<Awaited<ReturnType<typeof api.savePlaybackProgress>>>();
	vi.mocked(api.savePlaybackProgress).mockImplementationOnce(
		() => first.promise,
	);
	video.currentTime = 70;
	video.dispatchEvent(new Event("pause"));
	video.currentTime = 80;
	video.dispatchEvent(new Event("seeked"));
	video.currentTime = 10;
	video.dispatchEvent(new Event("seeked"));
	expect(api.savePlaybackProgress).toHaveBeenCalledTimes(1);
	first.resolve({
		status: "saved",
		progress: { ...session.progress, positionMs: 70000, lastSequence: 1 },
	});
	await controller.flush();
	expect(api.savePlaybackProgress).toHaveBeenCalledTimes(2);
	expect(vi.mocked(api.savePlaybackProgress).mock.calls[1]?.[1]).toMatchObject({
		positionMs: 10000,
		sequence: 3,
	});
});

test("failed history reads never save zero and can be retried", async () => {
	vi.mocked(api.openPlaybackSession).mockRejectedValueOnce(
		new Error("load failed"),
	);
	const { controller, video, state } = create();
	await controller.open();
	video.currentTime = 0;
	video.dispatchEvent(new Event("pause"));
	await controller.flush();
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
	expect(state()?.error?.operation).toBe("load");
	await controller.retry();
	expect(video.currentTime).toBe(40);
	expect(state()?.restored).toBe(true);
});

test("keeps an ambiguous failed payload for retry, or sends a newer position", async () => {
	const { controller, video, state } = create();
	await controller.open();
	vi.mocked(api.savePlaybackProgress).mockRejectedValueOnce(
		new Error("network"),
	);
	video.currentTime = 30;
	expect(await controller.flush()).toBe(false);
	const failed = vi.mocked(api.savePlaybackProgress).mock.calls[0]?.[1];
	expect(state()?.error?.operation).toBe("save");
	await controller.retry();
	expect(vi.mocked(api.savePlaybackProgress).mock.calls[1]?.[1]).toEqual(
		failed,
	);
	vi.mocked(api.savePlaybackProgress).mockRejectedValueOnce(
		new Error("network"),
	);
	video.currentTime = 50;
	await controller.flush();
	video.currentTime = 10;
	await controller.retry();
	expect(
		vi.mocked(api.savePlaybackProgress).mock.calls.at(-1)?.[1].positionMs,
	).toBe(10000);
});

test("saves periodically only while playing; ended saves duration and teardown releases after saving", async () => {
	vi.useFakeTimers();
	const { controller, video } = create();
	await controller.open();
	await vi.advanceTimersByTimeAsync(5000);
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
	Object.defineProperty(video, "paused", { value: false });
	video.currentTime = 45;
	await vi.advanceTimersByTimeAsync(5000);
	expect(api.savePlaybackProgress).toHaveBeenCalledTimes(1);
	video.currentTime = 99;
	video.dispatchEvent(new Event("ended"));
	await tick();
	expect(
		vi.mocked(api.savePlaybackProgress).mock.calls.at(-1)?.[1].positionMs,
	).toBe(100000);
	video.currentTime = 100;
	await controller.dispose();
	expect(api.releasePlaybackSession).toHaveBeenCalledWith(
		"token",
		expect.anything(),
	);
	expect(vi.getTimerCount()).toBe(0);
});

test("unmounting during open releases the late session without writing progress", async () => {
	const pending = deferred<PlaybackSessionResponse>();
	vi.mocked(api.openPlaybackSession).mockReturnValueOnce(pending.promise);
	const { controller } = create();
	const opening = controller.open();
	await tick();
	const disposal = controller.dispose();
	pending.resolve(session);
	await opening;
	await disposal;
	expect(api.releasePlaybackSession).toHaveBeenCalled();
	expect(api.savePlaybackProgress).not.toHaveBeenCalled();
});

test("StrictMode cleanup before open starts avoids creating an abandoned session", async () => {
	const { controller } = create();
	const opening = controller.open();
	await controller.dispose();
	await opening;
	expect(api.openPlaybackSession).not.toHaveBeenCalled();
});

test("pagehide flushing uses keepalive and still preserves write ordering", async () => {
	const { controller, video } = create();
	await controller.open();
	video.currentTime = 30;
	await controller.flush(true);
	expect(api.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ positionMs: 30000 }),
		expect.objectContaining({ keepalive: true }),
	);
});

test("a changed session requires explicit reopen rather than silently continuing to write", async () => {
	const { controller, video, state } = create();
	await controller.open();
	vi.mocked(api.savePlaybackProgress).mockRejectedValueOnce(
		new api.ApiClientError({
			kind: "http",
			code: "PLAYBACK_CONFLICT",
			status: 409,
			message: "changed",
		}),
	);
	video.currentTime = 30;
	await controller.flush();
	expect(state()?.error).not.toBeNull();
	vi.mocked(api.openPlaybackSession).mockResolvedValueOnce({
		...session,
		token: "new-token",
		generation: 2,
		progress: { ...session.progress, generation: 2, positionMs: 20000 },
	});
	await controller.retry();
	expect(video.currentTime).toBe(20);
	video.currentTime = 25;
	await controller.flush();
	expect(vi.mocked(api.savePlaybackProgress).mock.calls.at(-1)?.[0]).toBe(
		"new-token",
	);
});

test("seeking to zero saves normally without pausing or changing generation", async () => {
	const { controller, video } = create();
	await controller.open();
	const pause = vi.spyOn(video, "pause");
	video.currentTime = 0;
	video.dispatchEvent(new Event("seeked"));
	await tick();
	expect(pause).not.toHaveBeenCalled();
	expect(api.savePlaybackProgress).toHaveBeenCalledWith(
		"token",
		expect.objectContaining({ generation: 1, sequence: 1, positionMs: 0 }),
		expect.anything(),
	);
	video.currentTime = 3;
	video.dispatchEvent(new Event("seeked"));
	await tick();
	expect(api.savePlaybackProgress).toHaveBeenLastCalledWith(
		"token",
		expect.objectContaining({ generation: 1, sequence: 2, positionMs: 3000 }),
		expect.anything(),
	);
});
