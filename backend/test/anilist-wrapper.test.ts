import { expect, test, vi } from "vitest";
import { AniListAccountClient } from "../src/modules/anime/anilist/infrastructure/account-client.js";
import { AniListUpdatesClient } from "../src/modules/anime/anilist/infrastructure/updates-client.js";
import { withAniList } from "../src/modules/anime/anilist/infrastructure/wrapper.js";
import {
	type AniListClient,
	AniListError,
	AniListScheduler,
} from "../src/modules/anime/anilist/public.js";

test("wrapper isolates concurrent credentials, public reads and cancellation contexts", async () => {
	const request = vi.fn<AniListClient["request"]>(
		async (_query, _variables, options) => {
			await Promise.resolve();
			options.signal.throwIfAborted();
			return {
				Viewer: { id: options.token === "first" ? 1 : 2, name: "Viewer" },
			};
		},
	);
	const client = { request };
	const first = new AbortController();
	const second = new AbortController();
	const accounts = new AniListAccountClient(client);
	expect(
		await Promise.all([
			accounts.viewer("first", first.signal),
			accounts.viewer("second", second.signal),
		]),
	).toEqual([
		{ id: 1, name: "Viewer" },
		{ id: 2, name: "Viewer" },
	]);
	await withAniList(client, { signal: first.signal }, (sdk) =>
		sdk.graphql.request("query Public { Media { id } }"),
	);
	expect(request.mock.calls.map((call) => call[2])).toEqual([
		{ token: "first", signal: first.signal, priority: true },
		{ token: "second", signal: second.signal, priority: true },
		{ signal: first.signal },
	]);
	expect(request.mock.calls[0]?.[0]).toContain("id");
	expect(request.mock.calls[0]?.[0]).not.toContain("first");
});

test("wrapper preserves scheduler failure identity without retrying", async () => {
	for (const failure of [
		new AniListError({ code: "not-found", message: "Missing", retryAt: null }),
		new AniListError({ code: "rate-limited", message: "Wait", retryAt: 123 }),
		new Error("Cancelled"),
	]) {
		const request = vi
			.fn<AniListClient["request"]>()
			.mockRejectedValue(failure);
		await expect(
			new AniListAccountClient({ request }).viewer(
				"token",
				new AbortController().signal,
			),
		).rejects.toBe(failure);
		expect(request).toHaveBeenCalledTimes(1);
	}
});

test("wrapper mutation retains one-attempt policy and forwards authorization through scheduler", async () => {
	const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
		expect(new Headers(options?.headers).get("authorization")).toBe(
			"Bearer token",
		);
		const { query, variables } = JSON.parse(String(options?.body));
		expect(query.trimStart()).toMatch(/^mutation\b/);
		expect(variables).toEqual({ id: 10, progress: 4 });
		return Response.json(
			{ errors: [{ status: 429, message: "Wait" }] },
			{ status: 429 },
		);
	});
	const scheduler = new AniListScheduler({
		intervalMs: 0,
		attempts: 3,
		fetch: fetcher,
	});
	try {
		await expect(
			new AniListUpdatesClient(scheduler).save(
				7,
				1,
				10,
				{ progress: 4 },
				"token",
				new AbortController().signal,
			),
		).rejects.toMatchObject({ failure: { code: "rate-limited" } });
		expect(fetcher).toHaveBeenCalledTimes(1);
	} finally {
		await scheduler.close();
	}
});

test("wrapper cancellation never dispatches an already cancelled operation", async () => {
	const fetcher = vi.fn<typeof fetch>();
	const scheduler = new AniListScheduler({ intervalMs: 0, fetch: fetcher });
	const controller = new AbortController();
	controller.abort();
	try {
		await expect(
			new AniListAccountClient(scheduler).viewer("token", controller.signal),
		).rejects.toThrow("cancelled");
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		await scheduler.close();
	}
});
