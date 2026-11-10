import type { MoviElement, PlayerEventMap } from "movi-player/element";
import { expect, test, vi } from "vitest";
import { MoviClock } from "../../../src/features/playback/player/movi.js";

function fixture() {
	const handlers = new Map<string, Set<(data: never) => void>>();
	let seconds = 0;
	let state: PlayerEventMap["stateChange"] = "ready";
	const emit = <K extends keyof PlayerEventMap>(
		event: K,
		value: PlayerEventMap[K],
	) => {
		if (event === "stateChange") state = value as typeof state;
		for (const handler of handlers.get(event) ?? []) handler(value as never);
	};
	const originalPlay = vi.fn(async () => emit("stateChange", "playing"));
	const player = {
		getCurrentTime: () => seconds,
		getDuration: () => 8,
		getPlaybackRate: () => 1.25,
		getState: () => state,
		play: originalPlay,
		seek: vi.fn(async (time: number) => {
			seconds = time;
			emit("seeking", time);
			emit("seeked", time);
		}),
		on: <K extends keyof PlayerEventMap>(
			event: K,
			handler: (data: PlayerEventMap[K]) => void,
		) => {
			const set = handlers.get(event) ?? new Set();
			const callback = handler as (data: never) => void;
			set.add(callback);
			handlers.set(event, set);
			return () => {
				set.delete(callback);
				if (!set.size) handlers.delete(event);
			};
		},
	};
	const target = new EventTarget();
	const element = Object.assign(target, {
		player,
		play: vi.fn(() => player.play()),
	}) as unknown as MoviElement;
	const clock = new MoviClock(element);
	return {
		clock,
		player,
		element,
		handlers,
		emit,
		originalPlay,
		setTime: (value: number) => {
			seconds = value;
		},
	};
}

test("reads canonical seconds as integer milliseconds, including snapshots between events", () => {
	const f = fixture();
	f.setTime(4.123);
	expect(f.clock.currentTimeMs).toBe(4123);
	expect(f.clock.durationMs).toBe(8000);
	expect(f.clock.playbackRate).toBe(1.25);
	expect(f.clock.readyState).toBe(1);
});

test("resume seeks in seconds and both application and upstream play await positioning", async () => {
	for (const entry of ["application", "upstream"]) {
		const f = fixture();
		let finishSeek!: () => void;
		f.player.seek.mockImplementation(
			(time) =>
				new Promise<void>((resolve) => {
					finishSeek = () => {
						f.setTime(time);
						f.emit("seeked", time);
						resolve();
					};
				}),
		);
		f.clock.currentTimeMs = 4123;
		expect(f.clock.seeking).toBe(true);
		expect(f.clock.currentTimeMs).toBe(4123);
		const playing = entry === "application" ? f.clock.play() : f.player.play();
		await Promise.resolve();
		expect(f.player.seek).toHaveBeenCalledWith(4.123);
		expect(f.originalPlay).not.toHaveBeenCalled();
		finishSeek();
		await playing;
		expect(f.originalPlay).toHaveBeenCalledOnce();
		expect(f.clock.seeking).toBe(false);
		f.clock.dispose();
	}
});

test("a paused restored player reads its canonical clock after seek acknowledgement", async () => {
	const f = fixture();
	f.clock.currentTimeMs = 4000;
	await Promise.resolve();
	await Promise.resolve();
	expect(f.clock.currentTimeMs).toBe(4000);
	f.setTime(4.2);
	expect(f.clock.currentTimeMs).toBe(4200);
	f.emit("seeking", 5.4);
	expect(f.clock.currentTimeMs).toBe(5400);
	f.setTime(5.4);
	f.emit("seeked", 5.4);
	expect(f.clock.currentTimeMs).toBe(5400);
	f.emit("stateChange", "playing");
	expect(f.clock.currentTimeMs).toBe(5400);
});

test("seek initiation resolving does not acknowledge a position before core seeked", async () => {
	const f = fixture();
	f.player.seek.mockImplementation(async (time) => f.emit("seeking", time));
	f.clock.currentTimeMs = 4000;
	const playing = f.clock.play();
	await Promise.resolve();
	await Promise.resolve();
	expect(f.clock.seeking).toBe(true);
	expect(f.originalPlay).not.toHaveBeenCalled();
	f.setTime(4);
	f.emit("seeked", 4);
	await playing;
	expect(f.clock.seeking).toBe(false);
	expect(f.originalPlay).toHaveBeenCalledOnce();
});

test("initial zero restoration acknowledges immediately without a redundant decoder seek", async () => {
	const f = fixture();
	const acknowledged = vi.fn();
	f.clock.addEventListener("seeked", acknowledged);
	f.clock.currentTimeMs = 0;
	await f.clock.play();
	expect(f.player.seek).not.toHaveBeenCalled();
	expect(acknowledged).toHaveBeenCalledOnce();
	expect(f.originalPlay).toHaveBeenCalledOnce();
});

test("internal first-play alignment and recovery settle without a public seeked event", () => {
	const f = fixture();
	const acknowledged = vi.fn();
	f.clock.addEventListener("seeked", acknowledged);
	f.setTime(3);
	f.emit("stateChange", "seeking");
	expect(f.clock.seeking).toBe(true);
	expect(f.clock.currentTimeMs).toBe(3000);
	f.setTime(0.1);
	f.emit("seekcomplete", 0.1);
	f.emit("stateChange", "playing");
	expect(f.clock.seeking).toBe(false);
	expect(f.clock.currentTimeMs).toBe(100);
	expect(acknowledged).toHaveBeenCalledOnce();
});

test("a completed restored file replays from zero before playback starts", async () => {
	const f = fixture();
	f.clock.currentTimeMs = 8000;
	await f.clock.play();
	expect(f.player.seek.mock.calls).toEqual([[8], [0]]);
	expect(f.clock.currentTimeMs).toBe(0);
	expect(f.originalPlay).toHaveBeenCalledOnce();
});

test("natural completion reports the full duration even if Movi resets its clock", async () => {
	const f = fixture();
	const ended = vi.fn();
	f.clock.addEventListener("ended", ended);
	f.emit("stateChange", "playing");
	f.setTime(0);
	f.emit("ended", undefined);
	expect(f.clock.currentTimeMs).toBe(8000);
	expect(f.clock.paused).toBe(true);
	expect(f.clock.ended).toBe(true);
	expect(ended).toHaveBeenCalledOnce();
	await f.clock.play();
	expect(f.player.seek).toHaveBeenLastCalledWith(0);
	expect(f.clock.ended).toBe(false);
});

test("buffering, pause, seek, time and rate events preserve session evidence boundaries", () => {
	const f = fixture();
	const events: string[] = [];
	for (const event of [
		"playing",
		"waiting",
		"pause",
		"seeking",
		"seeked",
		"timeupdate",
		"ratechange",
	])
		f.clock.addEventListener(event, () => events.push(event));
	f.emit("stateChange", "playing");
	expect(f.clock.paused).toBe(false);
	f.emit("stateChange", "buffering");
	f.emit("stateChange", "paused");
	expect(f.clock.paused).toBe(true);
	f.emit("stateChange", "seeking");
	f.emit("seeking", 2.1);
	expect(f.clock.currentTimeMs).toBe(2100);
	f.emit("seeked", 2.1);
	f.emit("timeUpdate", 2.2);
	f.element.dispatchEvent(new Event("ratechange"));
	expect(events).toEqual([
		"playing",
		"waiting",
		"pause",
		"seeking",
		"seeked",
		"timeupdate",
		"ratechange",
	]);
});

test("a failed resume seek reports failure and prevents playback at the wrong position", async () => {
	const f = fixture();
	const error = new Error("seek unavailable");
	const failed = vi.fn();
	f.clock.addEventListener("error", failed);
	f.player.seek.mockRejectedValue(error);
	f.clock.currentTimeMs = 4000;
	await expect(f.clock.play()).rejects.toBe(error);
	expect(failed).toHaveBeenCalledOnce();
	expect(f.originalPlay).not.toHaveBeenCalled();
	expect(f.clock.seeking).toBe(false);
	// A subsequent successful seek permits an explicit retry.
	f.player.seek.mockImplementation(async (time) => {
		f.setTime(time);
		f.emit("seeked", time);
	});
	f.clock.currentTimeMs = 2000;
	await f.clock.play();
	expect(f.originalPlay).toHaveBeenCalledOnce();
});

test("queued seeks stay serialized and older acknowledgements cannot finish the latest seek", async () => {
	const f = fixture();
	const finishes: (() => void)[] = [];
	f.player.seek.mockImplementation(
		(time) =>
			new Promise<void>((resolve) =>
				finishes.push(() => {
					f.setTime(time);
					f.emit("seeked", time);
					resolve();
				}),
			),
	);
	const acknowledged = vi.fn();
	f.clock.addEventListener("seeked", acknowledged);
	f.clock.currentTimeMs = 2000;
	f.clock.currentTimeMs = 3000;
	await Promise.resolve();
	expect(f.player.seek.mock.calls).toEqual([[2]]);
	f.emit("seeked", 2);
	expect(f.clock.seeking).toBe(true);
	expect(acknowledged).not.toHaveBeenCalled();
	finishes[0]?.();
	await vi.waitFor(() => expect(f.player.seek.mock.calls).toEqual([[2], [3]]));
	const playing = f.clock.play();
	finishes[1]?.();
	await playing;
	expect(acknowledged).toHaveBeenCalledOnce();
	expect(f.originalPlay).toHaveBeenCalledOnce();
});

test("teardown detaches core and element listeners and cancels late playback", async () => {
	const f = fixture();
	let finishSeek!: () => void;
	f.player.seek.mockImplementation(
		() => new Promise<void>((resolve) => (finishSeek = resolve)),
	);
	const changed = vi.fn();
	f.clock.addEventListener("ratechange", changed);
	f.clock.currentTimeMs = 4000;
	const playing = f.clock.play();
	await Promise.resolve();
	f.clock.dispose();
	expect(f.handlers.size).toBe(0);
	expect(f.player.play).toBe(f.originalPlay);
	f.element.dispatchEvent(new Event("ratechange"));
	finishSeek();
	await playing;
	expect(changed).not.toHaveBeenCalled();
	expect(f.originalPlay).not.toHaveBeenCalled();
});
