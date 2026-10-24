import { expect, test, vi } from "vitest";
import { JackettQueryCache } from "../src/modules/acquisition/sources/jackett/query-cache.js";

const signal = () => new AbortController().signal;
const value = (input: string) => ({ value: input, ttlMs: 1000, weight: 1 });

test("a canceled waiter does not cancel another consumer of the same request", async () => {
	const cache = new JackettQueryCache<string>(2, 2, Date.now);
	const controller = new AbortController();
	let finish!: (input: ReturnType<typeof value>) => void;
	let sharedSignal!: AbortSignal;
	const load = vi.fn((signal: AbortSignal) => {
		sharedSignal = signal;
		return new Promise<ReturnType<typeof value>>((resolve) => {
			finish = resolve;
		});
	});
	const first = cache.read("same", controller.signal, load);
	const second = cache.read("same", signal(), load);
	const canceled = expect(first).rejects.toMatchObject({
		code: "request_cancelled",
	});
	await Promise.resolve();
	controller.abort();
	await canceled;
	expect(sharedSignal.aborted).toBe(false);
	finish(value("result"));
	await expect(second).resolves.toEqual({ value: "result", cache: "shared" });
	expect(load).toHaveBeenCalledTimes(1);
	await expect(cache.read("same", signal(), load)).resolves.toEqual({
		value: "result",
		cache: "hit",
	});
	cache.close();
});

test("the last canceled consumer aborts shared work and later calls get a new request", async () => {
	const cache = new JackettQueryCache<string>(2, 2, Date.now);
	const controller = new AbortController();
	let sharedSignal!: AbortSignal;
	let finish!: (input: ReturnType<typeof value>) => void;
	const pending = cache.read("same", controller.signal, (signal) => {
		sharedSignal = signal;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const canceled = expect(pending).rejects.toMatchObject({
		code: "request_cancelled",
	});
	await Promise.resolve();
	controller.abort();
	await canceled;
	expect(sharedSignal.aborted).toBe(true);
	await expect(
		cache.read("same", signal(), async () => value("new")),
	).resolves.toEqual({ value: "new", cache: "miss" });
	// A provider that settles after cancellation cannot replace newer cache evidence.
	finish(value("old"));
	await Promise.resolve();
	await expect(
		cache.read("same", signal(), async () => value("unexpected")),
	).resolves.toEqual({ value: "new", cache: "hit" });
	cache.close();
});

test("expiry, LRU and body weight bound saved query evidence", async () => {
	let now = 0;
	const cache = new JackettQueryCache<string>(2, 2, () => now);
	const load = vi.fn(async () => value("result"));
	await cache.read("first", signal(), load);
	await cache.read("second", signal(), load);
	await cache.read("first", signal(), load);
	await cache.read("third", signal(), load);
	expect((await cache.read("first", signal(), load)).cache).toBe("hit");
	expect((await cache.read("second", signal(), load)).cache).toBe("miss");
	now = 1000;
	expect((await cache.read("second", signal(), load)).cache).toBe("miss");
	const oversized = vi.fn(async () => ({ ...value("large"), weight: 3 }));
	await cache.read("large", signal(), oversized);
	await cache.read("large", signal(), oversized);
	expect(oversized).toHaveBeenCalledTimes(2);
	cache.close();
	await expect(cache.read("second", signal(), load)).rejects.toMatchObject({
		code: "request_cancelled",
	});
});
