import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ChangeQueue } from "../src/modules/resources/library/application/change-queue.js";
import { libraryPolicy } from "../src/modules/resources/library/policy.js";

const cleanup: ChangeQueue[] = [];
afterEach(async () => {
	for (const queue of cleanup.splice(0)) await queue.close();
	vi.useRealTimers();
});
function fixture(
	input: {
		isBusy?: () => boolean;
		apply?: (paths: readonly string[]) => Promise<boolean>;
		reconcile?: () => Promise<void>;
		maximumPendingChanges?: number;
	} = {},
) {
	vi.useFakeTimers();
	const apply = vi.fn(input.apply ?? (async () => true));
	const reconcile = vi.fn(input.reconcile ?? (async () => {}));
	const queue = new ChangeQueue({
		policy: {
			...libraryPolicy,
			changeDebounceMs: 20,
			monitorRetryMs: 100,
			monitorMaximumRetryMs: 800,
			maximumPendingChanges: input.maximumPendingChanges ?? 10,
		},
		logger: pino({ enabled: false }),
		isBusy: input.isBusy ?? (() => false),
		apply,
		reconcile,
	});
	cleanup.push(queue);
	return { queue, apply, reconcile };
}
test("busy synchronization retains coalesced paths, including new events arriving during publication", async () => {
	let busy = true;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let blocked = true;
	const f = fixture({
		isBusy: () => busy,
		apply: async () => {
			if (blocked) {
				blocked = false;
				await gate;
			}
			return true;
		},
	});
	f.queue.enqueue("a.mkv");
	f.queue.enqueue("a.mkv");
	await vi.advanceTimersByTimeAsync(60);
	expect(f.apply).not.toHaveBeenCalled();
	busy = false;
	await vi.advanceTimersByTimeAsync(20);
	expect(f.apply).toHaveBeenCalledWith(["a.mkv"]);
	f.queue.enqueue("b.mkv");
	release();
	await vi.advanceTimersByTimeAsync(20);
	expect(f.apply).toHaveBeenLastCalledWith(["b.mkv"]);
	expect(f.reconcile).not.toHaveBeenCalled();
});
test("overflow requests reconciliation and backs off repeated failures without applying an incomplete path set", async () => {
	const f = fixture({
		maximumPendingChanges: 2,
		reconcile: async () => {
			throw new Error("offline");
		},
	});
	f.queue.enqueue("a.mkv");
	f.queue.enqueue("b.mkv");
	f.queue.enqueue("c.mkv");
	expect(f.queue.degraded).toBe(true);
	await vi.advanceTimersByTimeAsync(99);
	expect(f.reconcile).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(199);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(f.reconcile).toHaveBeenCalledTimes(2);
	expect(f.apply).not.toHaveBeenCalled();
});
test("a new monitoring failure during reconciliation is retained and retried", async () => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const f = fixture({
		reconcile: async () => {
			await gate;
		},
	});
	f.queue.fail(new Error("first failure"));
	await vi.advanceTimersByTimeAsync(100);
	expect(f.reconcile).toHaveBeenCalledTimes(1);
	f.queue.fail(new Error("failure during recovery"));
	release();
	await vi.advanceTimersByTimeAsync(0);
	expect(f.queue.degraded).toBe(true);
	await vi.advanceTimersByTimeAsync(200);
	expect(f.reconcile).toHaveBeenCalledTimes(2);
	expect(f.queue.degraded).toBe(false);
});
test("shutdown drops queued work and disables future retries", async () => {
	const f = fixture();
	f.queue.enqueue("a.mkv");
	await f.queue.close();
	f.queue.enqueue("b.mkv");
	f.queue.fail(new Error("late callback"));
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.apply).not.toHaveBeenCalled();
	expect(f.reconcile).not.toHaveBeenCalled();
});
