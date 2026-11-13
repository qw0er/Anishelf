// @vitest-environment happy-dom
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { animeLibraryQuery } from "../../../src/features/anime/library/queries.js";
import type { AnimeLibraryResponse } from "../../../src/shared/api/contracts.js";
import { createQueryClient } from "../../../src/shared/api/query-client.js";
import { disconnectedList } from "../../app/support/state.js";

const cache = createQueryClient();
const fetcher = vi.fn<typeof fetch>();
const identity = { accountId: null, generation: "titles" };
const filters = { page: 1, sort: "title" as const };
const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
	});
function library(titlesRefreshing?: boolean): AnimeLibraryResponse {
	return {
		items: [
			{
				id: "anilist:anime:1",
				localWorkId: null,
				reference: { provider: "anilist", mediaType: "anime", id: "1" },
				displayTitle: "Original",
				format: "TV",
				year: 2026,
				episodeCount: 12,
				airedEpisodeCount: null,
				updatedAt: 1000,
				availableEpisodes: 0,
				availableRegularEpisodes: 0,
				metadataStale: false,
				coverUrl: null,
				viewingAvailability: "tracked",
				viewing: null,
				nextPlayback: null,
			},
		],
		page: 1,
		perPage: 24,
		hasNextPage: false,
		localState: "available",
		tracking: disconnectedList,
		...(titlesRefreshing === undefined ? {} : { titlesRefreshing }),
	};
}
beforeEach(() => {
	vi.useFakeTimers();
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cache.clear();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("title enrichment refreshes visible cards without clearing content and then returns to normal polling", async () => {
	const options = animeLibraryQuery(filters, "root", identity);
	const initial = library(true);
	cache.setQueryData(options.queryKey, initial);
	let complete: ((value: Response) => void) | undefined;
	fetcher.mockImplementation(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const observer = new QueryObserver(cache, options);
	const results: { title: string | undefined; pending: boolean }[] = [];
	const unsubscribe = observer.subscribe((result) => {
		results.push({
			title: result.data?.items[0]?.displayTitle,
			pending: result.isPending,
		});
	});
	try {
		await vi.advanceTimersByTimeAsync(1499);
		expect(fetcher).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(observer.getCurrentResult().data?.items[0]?.displayTitle).toBe(
			"Original",
		);
		expect(observer.getCurrentResult().isPending).toBe(false);
		const updated = library(false);
		const card = updated.items[0];
		if (!card || !complete) throw new Error("Expected a pending card refresh");
		card.displayTitle = "中文标题";
		complete(json(updated));
		await vi.advanceTimersByTimeAsync(0);
		expect(observer.getCurrentResult().data?.items[0]?.displayTitle).toBe(
			"中文标题",
		);
		expect(
			results.every((result) => result.title !== undefined && !result.pending),
		).toBe(true);
		await vi.advanceTimersByTimeAsync(1500);
		expect(fetcher).toHaveBeenCalledTimes(1);
	} finally {
		unsubscribe();
	}
});

test.each([false, undefined])(
	"idle title enrichment (%s) retains the normal polling interval",
	async (titlesRefreshing) => {
		const options = animeLibraryQuery(filters, "root", identity);
		cache.setQueryData(options.queryKey, library(titlesRefreshing));
		fetcher.mockImplementation(async () => json(library(titlesRefreshing)));
		const observer = new QueryObserver(cache, options);
		const unsubscribe = observer.subscribe(() => {});
		try {
			await vi.advanceTimersByTimeAsync(1500);
			expect(fetcher).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(5 * 60_000 - 1500);
			expect(fetcher).toHaveBeenCalledTimes(1);
		} finally {
			unsubscribe();
		}
	},
);

test("Tracking refresh still uses the short polling interval without title enrichment", async () => {
	const options = animeLibraryQuery(filters, "root", identity);
	const initial = library(false);
	initial.tracking = { ...initial.tracking, refreshing: true };
	cache.setQueryData(options.queryKey, initial);
	fetcher.mockImplementation(async () => json(library(false)));
	const observer = new QueryObserver(cache, options);
	const unsubscribe = observer.subscribe(() => {});
	try {
		await vi.advanceTimersByTimeAsync(1500);
		expect(fetcher).toHaveBeenCalledTimes(1);
	} finally {
		unsubscribe();
	}
});
