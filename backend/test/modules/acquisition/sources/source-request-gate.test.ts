import { setTimeout as delay } from "node:timers/promises";
import { expect, test, vi } from "vitest";
import { SourceError } from "../../../../src/modules/acquisition/sources/domain/model.js";
import { SourceRequestGate } from "../../../../src/modules/acquisition/sources/infrastructure/request-gate.js";
import {
	OutboundRequestScheduler,
	outboundCooldownOverflowKey,
} from "../../../../src/platform/network/request-scheduler.js";

const signal = () => new AbortController().signal;
const deferred = () => Promise.withResolvers<void>();

test("queues concurrent source requests while limiting active network operations", async () => {
	const gate = new SourceRequestGate(0);
	const held = deferred();
	let active = 0;
	let maximum = 0;
	const operation = vi.fn(async () => {
		active++;
		maximum = Math.max(maximum, active);
		await held.promise;
		active--;
	});
	const requests = ["one", "two", "three", "four"].map((key) =>
		gate.run(key, signal(), operation),
	);
	expect(operation).toHaveBeenCalledTimes(2);
	held.resolve();
	await Promise.all(requests);
	expect(operation).toHaveBeenCalledTimes(4);
	expect(maximum).toBe(2);
});

test("serializes shared hierarchical budgets without blocking unrelated origins", async () => {
	const gate = new SourceRequestGate(0);
	const held = deferred();
	const order: string[] = [];
	const first = gate.runMany(["connection", "site-a"], signal(), async () => {
		order.push("first");
		await held.promise;
	});
	const second = gate.runMany(["site-b", "connection"], signal(), async () => {
		order.push("second");
	});
	await gate.run("unrelated", signal(), async () => {
		order.push("unrelated");
	});
	expect(order).toEqual(["first", "unrelated"]);
	held.resolve();
	await Promise.all([first, second]);
	expect(order).toEqual(["first", "unrelated", "second"]);
});

test("paces repeated budget dispatches without reserving global network slots", async () => {
	const gate = new SourceRequestGate(25);
	const started: number[] = [];
	await gate.run("paced", signal(), async () => {
		started.push(Date.now());
	});
	let repeatedStarted = false;
	const repeated = gate.run("paced", signal(), async () => {
		repeatedStarted = true;
		started.push(Date.now());
	});
	await gate.run("unrelated", signal(), async () => {
		expect(repeatedStarted).toBe(false);
	});
	await repeated;
	expect((started[1] ?? 0) - (started[0] ?? 0)).toBeGreaterThanOrEqual(20);
});

test("publishes remote cooldown before releasing queued requests and persists it", async () => {
	let now = 1000;
	const onCooldown = vi.fn();
	const gate = new SourceRequestGate(0, () => now, { onCooldown });
	const held = deferred();
	const first = gate.runMany(["connection", "site"], signal(), async () => {
		await held.promise;
		throw new SourceError("rate_limited", 100_000);
	});
	const operation = vi.fn(async () => "unexpected");
	const queued = gate.runMany(
		["connection", "other-site"],
		signal(),
		operation,
	);
	const rejectedFirst = expect(first).rejects.toMatchObject({
		code: "rate_limited",
		retryAt: 100_000,
	});
	const rejectedQueued = expect(queued).rejects.toMatchObject({
		code: "rate_limited",
		retryAt: 100_000,
	});
	held.resolve();
	await Promise.all([rejectedFirst, rejectedQueued]);
	expect(operation).not.toHaveBeenCalled();
	expect(onCooldown).toHaveBeenCalledWith("connection", 100_000);
	expect(onCooldown).toHaveBeenCalledWith("site", 100_000);
	const restored = new SourceRequestGate(0, () => now, {
		cooldowns: { connection: 100_000 },
	});
	await expect(
		restored.run("connection", signal(), operation),
	).rejects.toMatchObject({
		code: "rate_limited",
		retryAt: 100_000,
	});
	now = 100_000;
	await expect(restored.run("connection", signal(), operation)).resolves.toBe(
		"unexpected",
	);
});

test("cancels queued requests promptly and never invokes their operation", async () => {
	const gate = new SourceRequestGate(0);
	const held = deferred();
	const first = gate.run("same", signal(), () => held.promise);
	const controller = new AbortController();
	const operation = vi.fn(async () => undefined);
	const queued = gate.run("same", controller.signal, operation);
	controller.abort();
	await expect(queued).rejects.toMatchObject({ code: "request_cancelled" });
	expect(operation).not.toHaveBeenCalled();
	held.resolve();
	await first;
	await gate.run("same", signal(), operation);
	expect(operation).toHaveBeenCalledTimes(1);
});

test("holds active concurrency until cancelled operations actually finish", async () => {
	const gate = new SourceRequestGate(0);
	const held = deferred();
	const controller = new AbortController();
	const first = gate.run("one", controller.signal, () => held.promise);
	const second = gate.run("two", signal(), () => held.promise);
	controller.abort();
	const operation = vi.fn(async () => "finished");
	const third = gate.run("three", signal(), operation);
	await delay(0);
	expect(operation).not.toHaveBeenCalled();
	const cancelled = expect(first).rejects.toMatchObject({
		code: "request_cancelled",
	});
	held.resolve();
	await Promise.all([cancelled, second]);
	await expect(third).resolves.toBe("finished");
});

test("bounds the queue, frees cancelled admissions and does not retry failures", async () => {
	const gate = new SourceRequestGate(0, Date.now, { maximumQueued: 1 });
	const held = deferred();
	const first = gate.run("one", signal(), () => held.promise);
	const second = gate.run("two", signal(), () => held.promise);
	const controller = new AbortController();
	const third = gate.run("three", controller.signal, async () => undefined);
	await expect(
		gate.run("four", signal(), async () => undefined),
	).rejects.toMatchObject({
		code: "source_busy",
	});
	controller.abort();
	await expect(third).rejects.toMatchObject({ code: "request_cancelled" });
	const failure = vi.fn(async () => {
		throw new SourceError("network_error");
	});
	const fourth = gate.run("four", signal(), failure);
	const rejected = expect(fourth).rejects.toMatchObject({
		code: "network_error",
	});
	held.resolve();
	await Promise.all([first, second, rejected]);
	expect(failure).toHaveBeenCalledTimes(1);
});

test("logs opaque budget identities and tolerates persistence failures", async () => {
	const logger = { debug: vi.fn(), warn: vi.fn() };
	const scheduler = new OutboundRequestScheduler({
		minimumIntervalMs: 0,
		logger,
		now: () => 1000,
		onCooldown: () => {
			throw new Error("unavailable");
		},
	});
	const privateKey = "https://private.example/?apikey=secret";
	await scheduler.run([privateKey], signal(), async () => undefined);
	scheduler.cooldown(privateKey, 2000);
	expect(scheduler.remainingRetryAt([privateKey])).toBe(2000);
	expect(
		JSON.stringify([logger.debug.mock.calls, logger.warn.mock.calls]),
	).not.toContain(privateKey);
	expect(logger.warn).toHaveBeenCalledTimes(2);
});

test("bounds budget tracking without forgetting pacing and recovers after expiry", async () => {
	let now = 1000;
	const scheduler = new OutboundRequestScheduler({
		minimumIntervalMs: 5000,
		maximumBudgets: 2,
		now: () => now,
	});
	await scheduler.run(["one"], signal(), async () => undefined);
	await scheduler.run(["two"], signal(), async () => undefined);
	const operation = vi.fn(async () => undefined);
	await expect(
		scheduler.run(["three"], signal(), operation),
	).rejects.toMatchObject({
		code: "queue_full",
	});
	expect(operation).not.toHaveBeenCalled();
	now += 5000;
	await scheduler.run(["three"], signal(), operation);
	expect(operation).toHaveBeenCalledTimes(1);
});

test("bounds cooldown tracking with a durable conservative overflow budget", async () => {
	const onCooldown = vi.fn();
	const scheduler = new OutboundRequestScheduler({
		minimumIntervalMs: 0,
		maximumBudgets: 2,
		now: () => 1000,
		onCooldown,
	});
	scheduler.cooldown("one", 2000);
	scheduler.cooldown("two", 3000);
	scheduler.cooldown("three", 4000);
	expect(onCooldown).toHaveBeenCalledWith(outboundCooldownOverflowKey, 4000);
	expect(scheduler.remainingRetryAt(["unrelated"])).toBe(4000);
	const restored = new OutboundRequestScheduler({
		now: () => 1000,
		cooldowns: { [outboundCooldownOverflowKey]: 4000 },
	});
	const operation = vi.fn(async () => undefined);
	await expect(
		restored.run(["unrelated"], signal(), operation),
	).rejects.toMatchObject({
		code: "cooldown",
		retryAt: 4000,
	});
	expect(operation).not.toHaveBeenCalled();
});

test("RSS and Jackett budgets keep independent five and ten second pacing", async () => {
	let now = 1000;
	const gate = new SourceRequestGate(5000, () => now, {
		minimumIntervalForKey: (key) =>
			key.startsWith("jackett:") ? 10_000 : 5000,
	});
	const rss = vi.fn(async () => undefined);
	const jackett = vi.fn(async () => undefined);
	await gate.run("origin:rss", signal(), rss);
	await gate.runMany(
		["origin:jackett", "jackett:connection"],
		signal(),
		jackett,
	);
	now = 6000;
	await gate.run("origin:rss", signal(), rss);
	expect(rss).toHaveBeenCalledTimes(2);
	const controller = new AbortController();
	const waiting = gate.runMany(
		["origin:jackett", "jackett:connection"],
		controller.signal,
		jackett,
	);
	await gate.run("origin:unrelated", signal(), async () => undefined);
	expect(jackett).toHaveBeenCalledTimes(1);
	controller.abort();
	await expect(waiting).rejects.toMatchObject({ code: "request_cancelled" });
	now = 11_000;
	await gate.runMany(
		["origin:jackett", "jackett:connection"],
		signal(),
		jackett,
	);
	expect(jackett).toHaveBeenCalledTimes(2);
});

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
	"rejects invalid per-budget interval %s before starting requests",
	async (interval) => {
		const scheduler = new OutboundRequestScheduler({
			minimumIntervalForKey: () => interval,
		});
		const operation = vi.fn(async () => undefined);
		await expect(
			scheduler.run(["invalid-policy"], signal(), operation),
		).rejects.toThrow(RangeError);
		expect(operation).not.toHaveBeenCalled();
	},
);
