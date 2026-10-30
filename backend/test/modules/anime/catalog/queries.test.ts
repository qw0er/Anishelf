import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { resourceRootId } from "../../../../src/modules/resources/resource-access/domain/identity.js";
import { createHttpApp } from "../../../support/http.js";
import { updateResourceSettings } from "../../../support/settings.js";

import {
	cleanups,
	confirm,
	details,
	fixture,
	logger,
	project,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("local search filters paginate deterministically over confirmed works", async () => {
	const f = await fixture(["A - 01.mkv", "B - 01.mkv", "C - 01.mkv"]);
	const selected = await rows(f);
	for (const [index, row] of selected.entries())
		await confirm(f, Promise.resolve([row]), String(index + 1));
	const first = await f.catalog.list({ perPage: 2 });
	const second = await f.catalog.list({ page: 2, perPage: 2 });
	expect(first.items).toHaveLength(2);
	expect(first.hasNextPage).toBe(true);
	expect(second.items).toHaveLength(1);
	expect(second.hasNextPage).toBe(false);
	expect(
		new Set([...first.items, ...second.items].map((item) => item.id)).size,
	).toBe(3);
	expect((await f.catalog.list({ query: "葬送" })).items).toHaveLength(3);
	expect((await f.catalog.list({ format: "MOVIE" })).items).toEqual([]);
	expect((await f.catalog.list({ year: 2022 })).items).toEqual([]);
	await expect(f.catalog.list({ perPage: 51 })).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
});

test("HTTP exposes safe typed DTOs, explicit confirmations and actionable validation/conflicts", async () => {
	const f = await fixture();
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const reviewResponse = await app.inject({ url: "/api/catalog/reviews" });
	expect(reviewResponse.statusCode).toBe(200);
	expect(reviewResponse.json().items[0].evidence.selectedEpisodes).toEqual(
		(await f.catalog.reviews()).items[0]?.evidence.selectedEpisodes,
	);
	expect(reviewResponse.headers["cache-control"]).toBe("no-store");
	expect(reviewResponse.body).not.toContain(f.root);
	const selected = await rows(f);
	const preview = await app.inject({
		method: "POST",
		url: "/api/catalog/previews",
		payload: { reference: project(f), rows: selected },
	});
	expect(preview.statusCode).toBe(200);
	const response = await app.inject({
		method: "POST",
		url: "/api/catalog/confirmations",
		payload: {
			previewId: preview.json().id,
			operationKey: "http",
			replace: false,
		},
	});
	expect(response.statusCode).toBe(200);
	const detail = await app.inject({
		url: `/api/catalog/works/${response.json().workId}/refresh`,
		method: "POST",
		payload: { revision: response.json().revision },
	});
	expect(detail.statusCode).toBe(200);
	expect(detail.body).not.toContain(f.root);
	expect(detail.json().work).not.toHaveProperty("title");
	expect(detail.json().work).not.toHaveProperty("aliases");
	const removedEdit = await app.inject({
		method: "PATCH",
		url: `/api/catalog/works/${response.json().workId}`,
		payload: {
			revision: response.json().revision,
			title: "Override",
			aliases: [],
		},
	});
	expect(removedEdit.statusCode).toBe(404);
	const invalid = await app.inject({
		method: "POST",
		url: "/api/catalog/confirmations",
		payload: { previewId: preview.json().id, operationKey: "http" },
	});
	expect(invalid.statusCode).toBe(400);
	const stale = await app.inject({
		method: "POST",
		url: "/api/catalog/previews",
		payload: { reference: project(f), rows: selected },
	});
	expect(stale.statusCode).toBe(409);
	expect(stale.json().error.code).toBe("CATALOG_CONFLICT");
	const missing = await app.inject({ url: "/api/catalog/works/missing" });
	expect(missing.statusCode).toBe(404);
	const malformed = await app.inject({ url: "/api/catalog/works?perPage=100" });
	expect(malformed.statusCode).toBe(404);
});

test("literal wildcard provider titles remain literal local search text", async () => {
	const f = await fixture();
	f.setData({
		...details(),
		titles: [
			{ value: "100% Anime", language: "en", kind: "romaji" },
			{ value: "[release]_special", language: null, kind: "alias" },
		],
	});
	await confirm(f);
	expect((await f.catalog.list({ query: "100%" })).items).toHaveLength(1);
	expect((await f.catalog.list({ query: "_special" })).items).toHaveLength(1);
	expect((await f.catalog.list({ query: "not_found%" })).items).toHaveLength(0);
});

test("poster artwork uses retained snapshots, delivers cached images offline and enforces active-root access", async () => {
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
		"base64",
	);
	const fetchArtwork = vi.fn<typeof fetch>(async () => new Response(png));
	const f = await fixture(undefined, fetchArtwork);
	f.setData({
		...details(),
		coverUrl:
			"https://s4.anilist.co/file/anilistcdn/media/anime/cover/fixture.png",
		bannerUrl: null,
	});
	const confirmed = await confirm(f);
	const before = f.get.mock.calls.length;
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const list = await f.catalog.getLocalWorkDetail(confirmed.workId);
	const cover = `/api/catalog/works/${confirmed.workId}/artwork/cover`;
	const pinnedUrl = `${cover}?v=${list.work.coverVersion}`;
	expect(pinnedUrl).toMatch(new RegExp(`^${cover}\\?v=[a-f0-9]{16}$`));
	expect(fetchArtwork).not.toHaveBeenCalled();
	const image = await app.inject({ url: cover });
	expect(image.statusCode).toBe(200);
	expect(image.headers["content-type"]).toBe("image/png");
	expect(image.headers["x-content-type-options"]).toBe("nosniff");
	expect(image.headers["cache-control"]).toBe("private, max-age=3600");
	expect(image.rawPayload).toEqual(png);
	const etag = image.headers.etag;
	expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
	const revalidated = await app.inject({
		url: cover,
		headers: { "if-none-match": etag as string },
	});
	expect(revalidated.statusCode).toBe(304);
	expect(revalidated.rawPayload).toHaveLength(0);
	expect(revalidated.headers.etag).toBe(etag);
	const pinned = await app.inject({ url: pinnedUrl });
	expect(pinned.headers["cache-control"]).toBe("private, max-age=86400");
	const stale = await app.inject({ url: `${cover}?v=${"0".repeat(16)}` });
	expect(stale.headers["cache-control"]).toBe("private, max-age=3600");
	fetchArtwork.mockRejectedValue(new Error("offline"));
	f.get.mockRejectedValue(new Error("provider offline"));
	expect((await app.inject({ url: cover })).statusCode).toBe(200);
	expect(fetchArtwork).toHaveBeenCalledTimes(1);
	expect(f.get).toHaveBeenCalledTimes(before);
	expect(
		(
			await app.inject({
				url: `/api/catalog/works/${confirmed.workId}/artwork/banner`,
			})
		).statusCode,
	).toBe(404);
	expect(
		(
			await app.inject({
				url: `/api/catalog/works/${confirmed.workId}/artwork/anything`,
			})
		).statusCode,
	).toBe(400);
	const nextRoot = join(f.base, "other-root");
	await mkdir(nextRoot);
	await updateResourceSettings(f.library, {
		resourceRoots: [nextRoot],
	});
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await app.inject({ url: cover })).statusCode).toBe(404);
});

test("file review batches use current source versions and enforce request bounds", async () => {
	const f = await fixture();
	const review = required((await f.catalog.reviews()).items[0]);
	expect(await f.catalog.fileReviews([review.fileId])).toMatchObject([
		{ id: review.id, decision: "pending" },
	]);
	await confirm(f);
	expect(
		(await f.catalog.fileReviews([review.fileId]))[0]?.associations,
	).toHaveLength(1);
	await expect(
		f.catalog.fileReviews([review.fileId, review.fileId]),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await expect(
		f.catalog.fileReviews(Array.from({ length: 101 }, (_, i) => String(i))),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await writeFile(
		join(f.root, review.relativePath),
		"replaced source contents",
	);
	// A new version must not inherit the old confirmed review, even before publication.
	expect(await f.catalog.fileReviews([review.fileId])).toEqual([]);
	await f.scan();
	expect((await f.catalog.fileReviews([review.fileId]))[0]?.decision).toBe(
		"pending",
	);
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const response = await app.inject({
		method: "POST",
		url: "/api/catalog/file-reviews",
		payload: { fileIds: [review.fileId] },
	});
	expect(response.statusCode).toBe(200);
	expect(response.body).not.toContain(f.root);
	expect(response.headers["cache-control"]).toBe("no-store");
});

test("work review filters match qualified candidates without admitting them and paginate", async () => {
	const f = await fixture([
		"Anime - 01.mkv",
		"Anime - 02.mkv",
		"Anime - 03.mkv",
	]);
	const selected = await rows(f, ["1", "2", "3"]);
	const confirmed = await confirm(f, Promise.resolve([required(selected[0])]));
	const results = f.automatic.getResults();
	const pendingFile = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	).fileId;
	const excluded = required(
		results.find((result) => result.source.fileId === pendingFile),
	);
	for (const result of results)
		result.proposals = [
			{
				candidate: {
					work: {
						reference: project(f),
						snapshotId: "fixture",
						season: null,
						part: null,
						titles: ["Anime"],
						year: 2023,
						format: "TV",
						episodeCount: 12,
					},
					score: 40,
					matcherVersion: "test",
					reasons: ["Possible title"],
					conflicts: [],
				},
				mapping: { targets: [], reasons: [], unresolved: ["Unknown episode"] },
			},
		];
	required(excluded.proposals[0]).candidate.work.reference = project(
		f,
		"other",
	);
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	const first = await f.catalog.reviews({
		workId: confirmed.workId,
		decision: "pending",
		perPage: 1,
	});
	expect(first.items).toHaveLength(1);
	expect(first.items[0]?.associations).toEqual([]);
	expect(first.hasNextPage).toBe(false);
	expect((await f.catalog.list()).items).toHaveLength(1);
	await expect(
		f.catalog.reviews({ workId: "unknown-work", decision: "pending" }),
	).rejects.toMatchObject({ code: "CATALOG_NOT_FOUND" });
	required(excluded.proposals[0]).candidate.work.reference = project(f);
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	expect(
		(
			await f.catalog.reviews({
				workId: confirmed.workId,
				decision: "pending",
				perPage: 1,
			})
		).hasNextPage,
	).toBe(true);
	expect(
		(
			await f.catalog.reviews({
				workId: confirmed.workId,
				decision: "pending",
				perPage: 1,
				page: 2,
			})
		).items,
	).toHaveLength(1);
});
