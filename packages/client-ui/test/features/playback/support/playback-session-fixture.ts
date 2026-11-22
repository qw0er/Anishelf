import {
	type MediaTimeline,
	originalTimeline,
} from "@anishelf/contracts/media";
import { afterEach, beforeEach, vi } from "vitest";
import * as playbackApi from "../../../../src/features/playback/player/api.js";
import { playbackPolicy } from "../../../../src/features/playback/player/policy.js";
import {
	type PlaybackBinding,
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../../../../src/features/playback/player/session.js";
import type { PlaybackSessionResponse } from "../../../../src/shared/api/contracts.js";
import { playerEvents } from "../../../support/player-events.js";

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
	let token: string | undefined;
	let current: HTMLVideoElement | null = document.createElement("video");
	const video = current;
	let timeline = originalTimeline();
	let binding: PlaybackBinding | null = null;
	let player: ReturnType<typeof playerEvents> | undefined;
	const controller = new PlaybackSessionController(
		"file",
		(next) => {
			state = next;
			if (next.session?.token === token) return;
			token = next.session?.token;
			connect();
		},
		policy,
	);
	controllers.push(controller);
	Object.defineProperty(video, "duration", { value: 100, configurable: true });
	Object.defineProperty(video, "readyState", {
		value: ready ? 1 : 0,
		configurable: true,
	});
	function connect() {
		player?.close();
		binding?.dispose();
		const version = state?.session?.sourceVersion;
		if (!current || !version) return;
		const next = controller.bind(timeline, version);
		if (!next) throw new Error("Missing playback binding.");
		binding = next;
		player = playerEvents(current, () => ({
			...next.events,
			initialPositionMs: next.initialPositionMs,
		}));
		if (current.readyState) player.ready();
	}
	return {
		controller,
		video,
		state: () => state,
		attach(
			next: HTMLVideoElement | null,
			assetTimeline: MediaTimeline = originalTimeline(),
		) {
			current = next;
			timeline = assetTimeline;
			connect();
		},
	};
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
