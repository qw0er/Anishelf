// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { localWorkDetailQuery } from "../src/features/anime/catalog/queries.js";
import { animeLibraryQuery } from "../src/features/anime/library/queries.js";
import { metadataDetailQuery } from "../src/features/anime/metadata/queries.js";
import { entryQuery } from "../src/features/anime/tracking/queries.js";
import type { TrackingListResponse } from "../src/shared/api/contracts.js";
import { createQueryClient } from "../src/shared/api/query-client.js";
import { toast } from "../src/shared/components/ui/toast.js";
import { animeDetailFixture, animeFixture } from "./fixtures/anime.js";
import { trackingProvider } from "./tracking-fixture.js";

const fetcher = vi.fn<typeof fetch>();
const identity = { accountId: "anilist:7", generation: "feedback-account" };
const filters = { page: 1, sort: "title" as const };
const clients: ReturnType<typeof createQueryClient>[] = [];
const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
	});
function client() {
	const value = createQueryClient();
	clients.push(value);
	return value;
}
function snapshot(): TrackingListResponse {
	return {
		...identity,
		provider: trackingProvider,
		state: "connected",
		fetchedAt: 1000,
		stale: true,
		refreshing: false,
		error: { code: "unavailable", retryAt: 2000 },
		entries: [],
	};
}
beforeEach(() => {
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
	vi.spyOn(toast, "add").mockReturnValue("notice");
	vi.spyOn(toast, "close").mockImplementation(() => {});
});
afterEach(() => {
	for (const value of clients.splice(0)) value.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("the same retained list failure notifies once across filters and entry reads, then re-arms after recovery", async () => {
	const cache = client();
	const state = snapshot();
	fetcher.mockImplementation(async (input) =>
		String(input).startsWith("/api/anime/library?")
			? json({
					items: [],
					page: 1,
					perPage: 24,
					hasNextPage: false,
					localState: "available",
					tracking: state,
				})
			: json({ ...state, entry: null }),
	);
	const query = {
		...animeLibraryQuery(filters, "root", identity),
		staleTime: 0,
	};
	await cache.fetchQuery(query);
	await cache.fetchQuery(query);
	await cache.fetchQuery(
		animeLibraryQuery({ ...filters, query: "other" }, "root", identity),
	);
	await cache.fetchQuery(entryQuery("2", identity));
	expect(toast.add).toHaveBeenCalledTimes(1);
	expect(toast.add).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "error",
			title: expect.stringContaining("Previously saved list data is retained"),
		}),
	);
	state.error = null;
	await cache.fetchQuery(query);
	state.error = { code: "unavailable", retryAt: 2000 };
	await cache.fetchQuery(query);
	expect(toast.add).toHaveBeenCalledTimes(2);
});

test("metadata failure envelopes notify once across local and provider details, without exposing provider text", async () => {
	const cache = client();
	const detail = animeFixture();
	detail.metadata.refreshError = {
		code: "unavailable",
		retryAt: 2000,
		message: "private provider response",
	};
	fetcher.mockImplementation(async (input) =>
		json(
			String(input).startsWith("/api/anime/details/")
				? animeDetailFixture(detail)
				: detail.metadata,
		),
	);
	await cache.fetchQuery(localWorkDetailQuery("work-1", "root"));
	await cache.fetchQuery(metadataDetailQuery({ id: "154587" }));
	await cache.fetchQuery({
		...localWorkDetailQuery("work-1", "root"),
		staleTime: 0,
	});
	expect(toast.add).toHaveBeenCalledTimes(1);
	expect(JSON.stringify(vi.mocked(toast.add).mock.calls)).not.toContain(
		"private provider response",
	);
	detail.metadata.refreshError.retryAt = 3000;
	await cache.fetchQuery({
		...localWorkDetailQuery("work-1", "root"),
		staleTime: 0,
	});
	expect(toast.add).toHaveBeenCalledTimes(2);
});

test.each(["initial", "authorization"])(
	"%s list failure relies on persistent page context",
	async (kind) => {
		const state = snapshot();
		if (kind === "initial") state.fetchedAt = null;
		else {
			state.state = "authorization-required";
			state.error = { code: "unauthorized", retryAt: null };
		}
		fetcher.mockResolvedValue(
			json({
				items: [],
				page: 1,
				perPage: 24,
				hasNextPage: false,
				localState: "available",
				tracking: state,
			}),
		);
		await client().fetchQuery(animeLibraryQuery(filters, "root", identity));
		expect(toast.add).not.toHaveBeenCalled();
	},
);

test("cancelled Library reads do not produce a failure Toast", async () => {
	fetcher.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
	await expect(
		client().fetchQuery(animeLibraryQuery(filters, "root", identity)),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(toast.add).not.toHaveBeenCalled();
});

test("repeated background transport failures retain cached Library data and notify once", async () => {
	const cache = client();
	const state = { ...snapshot(), error: null, stale: false };
	const result = {
		items: [],
		page: 1,
		perPage: 24,
		hasNextPage: false,
		localState: "available",
		tracking: state,
	};
	const query = {
		...animeLibraryQuery(filters, "root", identity),
		staleTime: 0,
		retry: false as const,
	};
	fetcher.mockResolvedValue(json(result));
	await cache.fetchQuery(query);
	fetcher.mockRejectedValue(new TypeError("private network detail"));
	await expect(cache.fetchQuery(query)).rejects.toBeTruthy();
	await expect(cache.fetchQuery(query)).rejects.toBeTruthy();
	expect(cache.getQueryData(query.queryKey)).toEqual(result);
	expect(toast.add).toHaveBeenCalledTimes(1);
	expect(JSON.stringify(vi.mocked(toast.add).mock.calls)).not.toContain(
		"private network detail",
	);
	fetcher.mockResolvedValue(json(result));
	await cache.fetchQuery(query);
	fetcher.mockRejectedValue(new TypeError("Offline again"));
	await expect(cache.fetchQuery(query)).rejects.toBeTruthy();
	expect(toast.add).toHaveBeenCalledTimes(2);
});
