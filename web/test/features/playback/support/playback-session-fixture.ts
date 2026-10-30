import { afterEach, beforeEach, vi } from "vitest";
import * as playbackApi from "../../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../../src/features/playback/player/policy.js";
import {
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../../../../src/features/playback/player/session.js";
import type { PlaybackSessionResponse } from "../../../../src/shared/api/contracts.js";

export const session: PlaybackSessionResponse = {
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

export function create(ready = true, policy = playbackPolicy) {
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

export async function tick() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

export function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

export function setupTestLifecycle() {
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
}
