import { expect, test, vi } from "vitest";
import { metadataDefaults } from "../../../../src/modules/anime/metadata/defaults.js";
import { createHttpApp } from "../../../support/http.js";

import {
	createProvider,
	failure,
	logger,
	media,
	noSignal,
	reference,
	setup,
	setupTestLifecycle,
	transport,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("manual refresh is coalesced and one caller cancellation does not abort another", async () => {
	const fetcher = transport();
	let resolve!: (value: Response) => void;
	fetcher.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const { application } = await setup(fetcher);
	const controller = new AbortController();
	const cancelled = application.get(reference, { signal: controller.signal });
	const rejection = expect(cancelled).rejects.toMatchObject({
		name: "AbortError",
	});
	const remaining = application.get(reference, { refresh: true });
	await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
	controller.abort();
	await rejection;
	resolve(Response.json({ data: { Media: media() } }));
	expect((await remaining).data.reference).toEqual(reference);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("last caller cancellation and shutdown promptly abort uncooperative transport", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { application, database } = await setup(fetcher);
	const controller = new AbortController();
	const task = application.get(reference, { signal: controller.signal });
	const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	controller.abort();
	await rejected;
	await application.close();
	expect(
		database.metadata.find(
			JSON.stringify([
				"anilist",
				"anilist-v1",
				"metadata-v1",
				"detail",
				reference,
			]),
		),
	).toBeNull();
});

test("rate headers pace retries and honor Retry-After/reset without bursts", async () => {
	vi.useFakeTimers();
	const fetcher = transport();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(null, {
				status: 429,
				headers: {
					"Retry-After": "2",
					"X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + 2),
					"X-RateLimit-Limit": "30",
				},
			}),
	);
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 2,
	});
	const task = provider.get(reference, noSignal());
	await vi.advanceTimersByTimeAsync(1000);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(3000);
	expect((await task).data.reference).toEqual(reference);
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test("temporary failures retry within bounds, invalid responses do not loop", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () => {
		throw new Error("network");
	});
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 2,
	});
	expect((await provider.get(reference, noSignal())).data.reference).toEqual(
		reference,
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
	fetcher.mockImplementationOnce(
		async () => new Response(null, { status: 400 }),
	);
	await failure(provider.get(reference, noSignal()), "invalid-request");
	expect(fetcher).toHaveBeenCalledTimes(3);
});

test("uncached work is bounded and queued cancellation does not launch extra requests", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { application } = await setup(fetcher);
	const controller = new AbortController();
	const tasks = Array.from(
		{ length: metadataDefaults.maximumPending + 1 },
		(_, index) =>
			application
				.get(
					{ ...reference, id: String(1000 + index) },
					{ signal: controller.signal },
				)
				.catch((error: unknown) => error),
	);
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	expect(await tasks.at(-1)).toMatchObject({ failure: { code: "busy" } });
	controller.abort();
	const cancelled = await Promise.all(tasks.slice(0, -1));
	expect(
		cancelled.every(
			(error) => error instanceof Error && error.name === "AbortError",
		),
	).toBe(true);
	await application.close();
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("HTTP request cancellation detaches its subscription and aborts unneeded provider work", async () => {
	const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
	const { publicMetadata } = await setup(fetcher);
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 0, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		const controller = new AbortController();
		const request = app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("154587").id}`,
			headers: { host: "localhost" },
			signal: controller.signal,
		});
		const rejected = expect(request).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		controller.abort();
		await rejected;
		await vi.waitFor(() =>
			expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true),
		);
	} finally {
		await app.close();
	}
});
