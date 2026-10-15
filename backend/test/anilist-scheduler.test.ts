import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { AniListScheduler } from "../src/modules/anime/anilist/public.js";

const schedulers: AniListScheduler[] = [];
afterEach(async () => {
	await Promise.all(schedulers.splice(0).map((value) => value.close()));
	vi.useRealTimers();
});
function scheduler(
	options: ConstructorParameters<typeof AniListScheduler>[0] = {},
) {
	const instance = new AniListScheduler({
		intervalMs: 0,
		attempts: 1,
		...options,
	});
	schedulers.push(instance);
	return instance;
}
const signal = () => new AbortController().signal;

test("shares pacing and keeps personal credentials off public requests", async () => {
	const calls: { time: number; auth: string | null }[] = [];
	const instance = scheduler({
		intervalMs: 40,
		fetch: async (_url, options) => {
			calls.push({
				time: Date.now(),
				auth: new Headers(options?.headers).get("authorization"),
			});
			return Response.json({ data: { ok: true } });
		},
	});
	const first = instance.request(
		"query Public { Media { id } }",
		{},
		{ signal: signal() },
	);
	const second = instance.request(
		"query Viewer { Viewer { id } }",
		{},
		{ signal: signal(), token: "fixture-token" },
	);

	await Promise.all([first, second]);
	expect(calls.map((value) => value.auth)).toEqual([
		null,
		"Bearer fixture-token",
	]);
	expect((calls[1]?.time ?? 0) - (calls[0]?.time ?? 0)).toBeGreaterThanOrEqual(
		35,
	);
});

test("prioritizes account work with bounded fairness", async () => {
	const order: string[] = [];
	const instance = scheduler({
		fetch: async (_url, options) => {
			order.push(JSON.parse(String(options?.body)).query);
			return Response.json({ data: { ok: true } });
		},
	});
	await Promise.all([
		instance.request("normal", {}, { signal: signal() }),
		...[1, 2, 3, 4].map((index) =>
			instance.request(
				`urgent${index}`,
				{},
				{ signal: signal(), priority: true },
			),
		),
	]);
	expect(order).toEqual(["urgent1", "urgent2", "urgent3", "normal", "urgent4"]);
});

test("new work enqueued in a completion callback is never stranded", async () => {
	const instance = scheduler({
		fetch: async () => Response.json({ data: { ok: true } }),
	});
	await instance
		.request("first", {}, { signal: signal() })
		.then(() => instance.request("second", {}, { signal: signal() }));
});

test("cancellation removes queued work and shutdown aborts uncooperative transport", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(() => new Promise(() => {}));
	const instance = scheduler({ fetch: fetcher });
	const first = instance.request("first", {}, { signal: signal() });
	const firstRejected = expect(first).rejects.toThrow();
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	const cancel = new AbortController();
	const second = instance.request("second", {}, { signal: cancel.signal });
	const secondRejected = expect(second).rejects.toThrow();
	cancel.abort();
	await secondRejected;
	await instance.close();
	await firstRejected;
	expect(fetcher).toHaveBeenCalledTimes(1);
	await expect(
		instance.request("third", {}, { signal: signal() }),
	).rejects.toThrow();
});

test("rate-limit feedback paces both kinds of work", async () => {
	const times: number[] = [];
	const instance = scheduler({
		fetch: async () => {
			times.push(Date.now());
			return times.length === 1
				? Response.json(
						{ data: { ok: true } },
						{
							headers: { "x-ratelimit-remaining": "0", "retry-after": "0.04" },
						},
					)
				: Response.json({ data: { ok: true } });
		},
	});
	const jobs = [
		instance.request("public", {}, { signal: signal() }),
		instance.request(
			"personal",
			{},
			{ signal: signal(), token: "fixture-token" },
		),
	];

	await Promise.all(jobs);
	expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(40);
});

test("auth errors and partial data never return or retain echoed credentials", async () => {
	const instance = scheduler({
		fetch: async () =>
			Response.json({
				data: { Viewer: { id: 7 } },
				errors: [{ status: 401, message: "fixture-secret" }],
			}),
	});
	await expect(
		instance.request(
			"query Viewer",
			{},
			{ signal: signal(), token: "fixture-secret" },
		),
	).rejects.toMatchObject({ failure: { code: "unauthorized" } });
	try {
		await instance.request(
			"query Viewer",
			{},
			{ signal: signal(), token: "fixture-secret" },
		);
	} catch (error) {
		expect(String(error)).not.toContain("fixture-secret");
		expect((error as Error).cause).toBeUndefined();
	}
});

test("never retries mutations with an uncertain outcome", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockRejectedValue(new Error("withheld"));
	const instance = scheduler({ fetch: fetcher, attempts: 3 });
	await expect(
		instance.request(
			"mutation Change { SaveMediaListEntry { id } }",
			{},
			{ signal: signal(), token: "fixture-token" },
		),
	).rejects.toThrow();
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("request diagnostics correlate retry and success without provider or credential payloads", async () => {
	let output = "";
	let attempts = 0;
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	const instance = scheduler({
		logger,
		attempts: 2,
		random: () => 0,
		fetch: async () => {
			attempts++;
			if (attempts === 1) throw new Error("raw-network-token-sentinel");
			return Response.json({ data: { private: "private-response-sentinel" } });
		},
	});
	await instance.request(
		"query PrivateQuerySentinel { Viewer { id } }",
		{ private: "private-variable-sentinel" },
		{ token: "private-token-sentinel", signal: signal(), priority: true },
	);
	const records = output
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const queued = records.find(
		(record) => record.event === "anilist.request_queued",
	);
	expect(queued).toMatchObject({
		level: 10,
		kind: "query",
		authenticated: true,
		priority: true,
		queueDepth: 1,
	});
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "anilist.request_retrying",
				level: 40,
				attempt: 1,
				nextAttempt: 2,
				code: "unavailable",
				requestId: queued.requestId,
			}),
			expect.objectContaining({
				event: "anilist.request_succeeded",
				level: 10,
				requestId: queued.requestId,
			}),
		]),
	);
	for (const secret of [
		"PrivateQuerySentinel",
		"private-variable-sentinel",
		"private-token-sentinel",
		"raw-network-token-sentinel",
		"private-response-sentinel",
	])
		expect(output).not.toContain(secret);
});

test("rate limit and final failure logs omit raw GraphQL errors", async () => {
	let output = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	const instance = scheduler({
		logger,
		fetch: async () =>
			Response.json({
				errors: [{ status: 429, message: "private-provider-error-sentinel" }],
			}),
	});
	await expect(
		instance.request("query Private", {}, { signal: signal() }),
	).rejects.toMatchObject({ failure: { code: "rate-limited" } });
	const records = output
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "anilist.rate_limited",
				source: "graphql",
				level: 40,
			}),
			expect.objectContaining({
				event: "anilist.request_failed",
				code: "rate-limited",
				level: 40,
			}),
		]),
	);
	expect(output).not.toContain("private-provider-error-sentinel");
});

test("queue overflow, queued cancellation and active shutdown are observable without abort reasons", async () => {
	let output = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(() => new Promise(() => {}));
	const instance = scheduler({ logger, maximumPending: 1, fetch: fetcher });
	const active = instance.request("first", {}, { signal: signal() });
	const activeRejected = expect(active).rejects.toThrow();
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	const cancel = new AbortController();
	const waiting = instance.request("second", {}, { signal: cancel.signal });
	const waitingRejected = expect(waiting).rejects.toThrow();
	await expect(
		instance.request("third", {}, { signal: signal() }),
	).rejects.toMatchObject({ failure: { code: "busy" } });
	cancel.abort(new Error("private-abort-reason-sentinel"));
	await waitingRejected;
	await instance.close();
	await activeRejected;
	const records = output
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "anilist.queue_full",
				queueDepth: 1,
				level: 40,
			}),
			expect.objectContaining({
				event: "anilist.request_cancelled",
				stage: "queued",
				reason: "caller",
				level: 20,
			}),
			expect.objectContaining({
				event: "anilist.request_cancelled",
				stage: "active",
				reason: "shutdown",
				level: 20,
			}),
			expect.objectContaining({ event: "anilist.stopped", level: 20 }),
		]),
	);
	expect(output).not.toContain("private-abort-reason-sentinel");
});
