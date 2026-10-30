import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { AniListAccountClient } from "../../../../src/modules/anime/anilist/infrastructure/account-client.js";
import { AniListUpdatesClient } from "../../../../src/modules/anime/anilist/infrastructure/updates-client.js";
import {
	type AniListOptions,
	AniListWrapper,
} from "../../../../src/modules/anime/anilist/public.js";

const clients: AniListWrapper[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.close()));
	vi.useRealTimers();
});
function client(options: AniListOptions = {}) {
	const value = new AniListWrapper({ intervalMs: 0, attempts: 1, ...options });
	clients.push(value);
	return value;
}
function read(
	value: AniListWrapper,
	signal = new AbortController().signal,
	token?: string,
) {
	return value.execute({ signal, ...(token ? { token } : {}) }, (sdk) =>
		sdk.graphql.request("query Public { Media { id } }"),
	);
}
test("SDK native transport isolates concurrent credentials and public reads", async () => {
	const credentials: (string | null)[] = [];
	const value = client({
		fetch: async (_url, options) => {
			const auth = new Headers(options?.headers).get("authorization");
			credentials.push(auth);
			return Response.json({
				data: {
					Viewer: { id: auth === "Bearer first" ? 1 : 2, name: "Viewer" },
				},
			});
		},
	});
	const accounts = new AniListAccountClient(value);
	expect(
		await Promise.all([
			accounts.viewer("first", new AbortController().signal),
			accounts.viewer("second", new AbortController().signal),
		]),
	).toEqual([
		{ id: 1, name: "Viewer" },
		{ id: 2, name: "Viewer" },
	]);
	await read(value);
	expect(credentials).toEqual(["Bearer first", "Bearer second", null]);
});
test("SDK shared limiter paces public and authenticated operations", async () => {
	vi.useFakeTimers();
	const times: number[] = [];
	const value = client({
		intervalMs: 40,
		fetch: async () => {
			times.push(Date.now());
			return Response.json({ data: {} });
		},
	});
	const tasks = Promise.all([read(value), read(value, undefined, "token")]);
	await vi.advanceTimersByTimeAsync(0);
	expect(times).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(40);
	await tasks;
	expect((times[1] ?? 0) - (times[0] ?? 0)).toBe(40);
});
test("SDK header feedback blocks the next operation after an exhausted budget", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json(
			{ data: {} },
			{ headers: { "x-ratelimit-remaining": "0", "retry-after": "2" } },
		),
	);
	const value = client({ fetch: fetcher });
	const tasks = Promise.all([read(value), read(value)]);
	await vi.advanceTimersByTimeAsync(0);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1999);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1);
	await tasks;
	expect(fetcher).toHaveBeenCalledTimes(2);
});
test("SDK retries query HTTP failures but mutations have one transport attempt", async () => {
	vi.useFakeTimers();
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { status: 503 }))
		.mockImplementation(async () => Response.json({ data: {} }));
	const value = client({ attempts: 3, fetch: fetcher });
	const task = read(value);
	await vi.runAllTimersAsync();
	await task;
	expect(fetcher).toHaveBeenCalledTimes(2);
	fetcher.mockClear();
	fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
	await expect(
		new AniListUpdatesClient(value).save(
			7,
			1,
			10,
			{ progress: 4 },
			"token",
			new AbortController().signal,
		),
	).rejects.toMatchObject({ failure: { code: "unavailable" } });
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("SDK mutation network failure is never replayed", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockRejectedValue(new Error("private network error"));
	const value = client({ attempts: 3, fetch: fetcher });
	await expect(
		new AniListUpdatesClient(value).save(
			7,
			1,
			10,
			{ progress: 4 },
			"token",
			new AbortController().signal,
		),
	).rejects.toMatchObject({ failure: { code: "unavailable" } });
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("SDK error mapping rejects partial data and redacts provider details", async () => {
	for (const [status, code] of [
		[401, "unauthorized"],
		[403, "unauthorized"],
		[404, "not-found"],
		[429, "rate-limited"],
		[400, "invalid-request"],
	] as const) {
		const value = client({
			fetch: async () =>
				Response.json({
					data: { Viewer: { id: 7 } },
					errors: [{ status, message: "private secret" }],
				}),
		});
		const error = await read(value).catch((error: unknown) => error);
		expect(error).toMatchObject({ failure: { code } });
		expect(String(error)).not.toContain("private secret");
		expect((error as Error).cause).toBeUndefined();
	}
});
test("already cancelled operations never dispatch", async () => {
	const fetcher = vi.fn<typeof fetch>();
	const value = client({ fetch: fetcher });
	const controller = new AbortController();
	controller.abort();
	await expect(read(value, controller.signal)).rejects.toThrow("cancelled");
	expect(fetcher).not.toHaveBeenCalled();
});
test("queued cancellation and shutdown abort SDK work without dispatching queued requests", async () => {
	const fetcher = vi.fn<typeof fetch>(
		async (_url, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			}),
	);
	const value = client({ fetch: fetcher });
	const active = expect(read(value)).rejects.toThrow("cancelled");
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	const controller = new AbortController();
	const queued = expect(read(value, controller.signal)).rejects.toThrow(
		"cancelled",
	);
	controller.abort();
	await queued;
	await value.close();
	await active;
	await expect(read(value)).rejects.toThrow("cancelled");
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("SDK timeout aborts native fetch", async () => {
	vi.useFakeTimers();
	const value = client({
		timeoutMs: 50,
		fetch: async (_url, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			}),
	});
	const failure = expect(read(value)).rejects.toMatchObject({
		failure: { code: "unavailable" },
	});
	await vi.advanceTimersByTimeAsync(50);
	await failure;
});
test("SDK adapter diagnostics never expose tokens, payloads or raw errors", async () => {
	let output = "";
	const logger = pino(
		{ level: "trace" },
		{
			write: (line: string) => {
				output += line;
			},
		},
	);
	const value = client({
		logger,
		fetch: async () =>
			Response.json({
				errors: [{ message: "private-provider-sentinel", status: 401 }],
			}),
	});
	await expect(
		read(value, undefined, "private-token-sentinel"),
	).rejects.toThrow();
	expect(output).toContain("anilist.request_attempt");
	expect(output).toContain("anilist.request_failed");
	expect(output).not.toContain("private-provider-sentinel");
	expect(output).not.toContain("private-token-sentinel");
});
