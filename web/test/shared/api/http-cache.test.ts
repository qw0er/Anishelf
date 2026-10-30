// @vitest-environment happy-dom
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { animeDetailQuery } from "../../../src/features/anime/catalog/detail-query.js";
import { localWorkDetailQuery } from "../../../src/features/anime/catalog/queries.js";
import { animeStatusQuery } from "../../../src/features/anime/catalog/status-query.js";
import { invalidateAnimeQueries } from "../../../src/features/anime/shared/query-keys.js";
import * as api from "../../../src/shared/api/client.js";
import {
	createQueryClient,
	loadQuery,
} from "../../../src/shared/api/query-client.js";
import {
	animeDetailFixture,
	animeFixture,
	animeStatusFixture,
} from "../../fixtures/anime.js";

const clients: ReturnType<typeof createQueryClient>[] = [];
function client() {
	const value = createQueryClient();
	clients.push(value);
	return value;
}
afterEach(() => {
	for (const value of clients.splice(0)) value.clear();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("loader, mounted detail and the alternate work identity reuse the same fresh response", async () => {
	const cache = client();
	const detail = animeDetailFixture(animeFixture());
	const request = vi.spyOn(api, "request").mockResolvedValue(detail);
	const options = localWorkDetailQuery(detail.local?.work.id ?? "", "scope");
	const controller = new AbortController();
	await loadQuery(options, controller.signal, cache);
	await cache.fetchQuery(options);
	const canonical = await cache.fetchQuery(
		animeDetailQuery("anilist:anime:154587", "scope"),
	);
	expect(canonical).toEqual(detail);
	expect(request).toHaveBeenCalledTimes(1);
});

test("resolving a tracked work with local episodes seeds the local route without a second request", async () => {
	const cache = client();
	const detail = animeDetailFixture(animeFixture());
	const request = vi.spyOn(api, "request").mockResolvedValue(detail);
	await cache.fetchQuery(animeDetailQuery("anilist:anime:154587", "scope"));
	const local = await cache.fetchQuery(localWorkDetailQuery("work-1", "scope"));
	expect(local.work.id).toBe("work-1");
	expect(request).toHaveBeenCalledTimes(1);
});

test("active status polling never rereads full detail or closed activity and stops on unmount", async () => {
	vi.useFakeTimers();
	const cache = client();
	const status = {
		...animeStatusFixture(),
		downloads: { active: 1, attention: 0, total: 1 },
	};
	const request = vi.spyOn(api, "request").mockResolvedValue(status);
	const observer = new QueryObserver(
		cache,
		animeStatusQuery("anilist:anime:154587", "scope"),
	);
	const unsubscribe = observer.subscribe(() => {});
	await vi.advanceTimersByTimeAsync(0);
	await vi.advanceTimersByTimeAsync(15_000);
	expect(request).toHaveBeenCalledTimes(4);
	expect(
		request.mock.calls.every(([path]) => path.startsWith("/api/anime/status/")),
	).toBe(true);
	unsubscribe();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(request).toHaveBeenCalledTimes(4);
});

test("a subscription change only invalidates its status, preserving unrelated detail and status caches", async () => {
	const cache = client();
	const own = animeStatusQuery("anilist:anime:1", "scope").queryKey;
	const other = animeStatusQuery("anilist:anime:2", "scope").queryKey;
	const detail = animeDetailQuery("anilist:anime:1", "scope").queryKey;
	cache.setQueryData(own, animeStatusFixture());
	cache.setQueryData(other, animeStatusFixture());
	cache.setQueryData(detail, animeDetailFixture(animeFixture()));
	await invalidateAnimeQueries(cache, "acquisition", "anilist:anime:1");
	expect(cache.getQueryState(own)?.isInvalidated).toBe(true);
	expect(cache.getQueryState(other)?.isInvalidated).toBe(false);
	expect(cache.getQueryState(detail)?.isInvalidated).toBe(false);
});
