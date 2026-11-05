// @vitest-environment happy-dom
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, test } from "vitest";
import { animeDetailQuery } from "../../../src/features/anime/catalog/detail-query.js";
import { localWorkDetailQuery } from "../../../src/features/anime/catalog/queries.js";
import { animeLibraryQuery } from "../../../src/features/anime/library/queries.js";
import type { AnimeLibraryResponse } from "../../../src/shared/api/contracts.js";
import { createQueryClient } from "../../../src/shared/api/query-client.js";
import { disconnectedList } from "../../app/support/state.js";
import { animeDetailFixture, animeFixture } from "../../fixtures/anime.js";

const cache = createQueryClient();
afterEach(() => cache.clear());
const scope = (revision: number, root = "/media") =>
	JSON.stringify([[root], revision]);

test("library retains cards across publications but isolates roots, accounts and filters", () => {
	const identity = { accountId: null, generation: "fixture" };
	const filters = { page: 1, sort: "title" as const };
	const options = (
		revision: number,
		root = "/media",
		account = identity,
		query = "",
	) => ({
		...animeLibraryQuery({ ...filters, query }, scope(revision, root), account),
		enabled: false,
	});
	const data: AnimeLibraryResponse = {
		items: [],
		page: 1,
		perPage: 24,
		hasNextPage: false,
		localState: "available",
		tracking: disconnectedList,
	};
	cache.setQueryData(options(1).queryKey, data);
	const observer = new QueryObserver(cache, options(1));
	const unsubscribe = observer.subscribe(() => {});
	observer.setOptions(options(2));
	expect(observer.getCurrentResult().data).toBe(data);
	expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
	// Presentation data must not populate the new publication's cache.
	expect(cache.getQueryData(options(2).queryKey)).toBeUndefined();
	observer.setOptions(options(2, "/other"));
	expect(observer.getCurrentResult().data).toBeUndefined();
	observer.setOptions(options(1));
	observer.setOptions(options(2, "/media", { ...identity, generation: "new" }));
	expect(observer.getCurrentResult().data).toBeUndefined();
	observer.setOptions(options(1));
	observer.setOptions(options(2, "/media", identity, "other"));
	expect(observer.getCurrentResult().data).toBeUndefined();
	unsubscribe();
});

test("local detail retains content across publications and rejects other works or roots", () => {
	const detail = animeDetailFixture(animeFixture());
	if (!detail.local) throw new Error("Missing local fixture");
	const data = { ...detail.local, detail };
	const options = (revision: number, id = "work-1", root = "/media") => ({
		...localWorkDetailQuery(id, scope(revision, root)),
		enabled: false,
	});
	cache.setQueryData(options(1).queryKey, data);
	const observer = new QueryObserver(cache, options(1));
	const unsubscribe = observer.subscribe(() => {});
	observer.setOptions(options(2));
	expect(observer.getCurrentResult().data).toBe(data);
	expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
	observer.setOptions(options(2, "work-2"));
	expect(observer.getCurrentResult().data).toBeUndefined();
	observer.setOptions(options(1));
	observer.setOptions(options(2, "work-1", "/other"));
	expect(observer.getCurrentResult().data).toBeUndefined();
	unsubscribe();
});

test("canonical detail retains its publication while a new one loads", () => {
	const data = animeDetailFixture(animeFixture());
	const options = (revision: number, key = "anilist:anime:154587") => ({
		...animeDetailQuery(key, scope(revision)),
		enabled: false,
	});
	cache.setQueryData(options(1).queryKey, data);
	const observer = new QueryObserver(cache, options(1));
	const unsubscribe = observer.subscribe(() => {});
	observer.setOptions(options(2));
	expect(observer.getCurrentResult().data).toBe(data);
	observer.setOptions(options(2, "anilist:anime:1"));
	expect(observer.getCurrentResult().data).toBeUndefined();
	unsubscribe();
});
