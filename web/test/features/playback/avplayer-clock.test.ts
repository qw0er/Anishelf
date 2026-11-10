import type AVPlayerUI from "@libmedia/avplayer-ui";
import { expect, test, vi } from "vitest";
import {
	AVPlayerClock,
	decoderResource,
} from "../../../src/features/playback/player/avplayer.js";

function fixture() {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const player = {
		currentTime: 0n,
		getDuration: () => 8000n,
		getPlaybackRate: () => 1,
		getStatus: () => 4,
		play: vi.fn(async () => {}),
		seek: vi.fn(async (_time: bigint) => {}),
		on: (event: string, handler: (...args: unknown[]) => void) =>
			handlers.set(event, handler),
		off: (event: string) => handlers.delete(event),
	};
	const clock = new AVPlayerClock(player as unknown as AVPlayerUI);
	return {
		player,
		clock,
		emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
		handlers,
	};
}
test("pause snapshots read the canonical millisecond clock even before the next time event", () => {
	const f = fixture();
	f.player.currentTime = 4123n;
	expect(f.clock.currentTimeMs).toBe(4123);
	expect(f.clock.durationMs).toBe(8000);
});
test("restoration remains seeking until the engine acknowledges positioning", async () => {
	const f = fixture();
	f.clock.currentTimeMs = 4000;
	expect(f.player.seek).toHaveBeenCalledWith(4000n);
	expect(f.clock.seeking).toBe(true);
	expect(f.clock.currentTimeMs).toBe(4000);
	f.player.currentTime = 4000n;
	f.emit("seeked");
	expect(f.clock.seeking).toBe(false);
	expect(f.clock.currentTimeMs).toBe(4000);
});
test("natural completion reports duration even if the engine resets its playback clock", () => {
	const f = fixture();
	f.player.currentTime = 0n;
	f.emit("ended");
	expect(f.clock.ended).toBe(true);
	expect(f.clock.paused).toBe(true);
	expect(f.clock.currentTimeMs).toBe(8000);
});
test("resume snapshots retain the restored position before upstream starts its render clock", async () => {
	const f = fixture();
	f.clock.currentTimeMs = 4000;
	await Promise.resolve();
	f.emit("seeked");
	expect(f.player.currentTime).toBe(0n);
	expect(f.clock.currentTimeMs).toBe(4000);
	f.player.currentTime = 4100n;
	f.emit("played");
	expect(f.clock.currentTimeMs).toBe(4100);
});
test("upstream UI play waits for the resume seek to complete", async () => {
	const f = fixture();
	let finishSeek!: () => void;
	f.player.seek.mockImplementation(
		() =>
			new Promise((resolve) => {
				finishSeek = resolve;
			}),
	);
	const play = vi.fn(async () => {});
	// Reattach so the adapter captures this engine implementation.
	f.clock.dispose();
	f.player.play = play;
	const clock = new AVPlayerClock(f.player as unknown as AVPlayerUI);
	clock.currentTimeMs = 4000;
	const playing = f.player.play();
	expect(play).not.toHaveBeenCalled();
	finishSeek();
	await playing;
	expect(play).toHaveBeenCalledTimes(1);
	clock.dispose();
	expect(f.player.play).toBe(play);
});
test("disposing the adapter detaches its engine listeners", () => {
	const f = fixture();
	expect(f.handlers.size).toBeGreaterThan(0);
	f.clock.dispose();
	expect(f.handlers.size).toBe(0);
});
test("playing a restored completed file replays from zero before decoder initialization", async () => {
	const f = fixture();
	f.clock.currentTimeMs = 8000;
	await f.clock.play();
	expect(f.player.seek).toHaveBeenLastCalledWith(0n);
	expect(f.clock.currentTimeMs).toBe(0);
});
test("decoder requests are same-origin playback resources and unsupported codecs are explicit", () => {
	expect(decoderResource("decoder", 94230, 3)).toBe("");
	expect(decoderResource("decoder", 94214, 3)).toBe("");
	expect(decoderResource("decoder", 86020)).toBe(
		"/libmedia/1.3.1/decode/dca.wasm",
	);
	expect(() => decoderResource("decoder", 99999)).toThrow(
		"Unsupported media codec",
	);
	expect(() => decoderResource("encoder", 27)).toThrow(
		"Unsupported playback resource",
	);
});
