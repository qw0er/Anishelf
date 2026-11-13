import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { resourceRootId } from "../../../../src/modules/resources/resource-access/domain/identity.js";
import { createHttpApp } from "../../../support/http.js";
import {
	cleanups,
	confirm,
	details,
	enableAutomatic,
	fixture,
	logger,
	project,
	required,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("unambiguous scanner identification automatically admits sources and preserves corrections across rescan/restart", async () => {
	const f = await fixture(
		["Anime - 01.mkv", "Anime - 02.mkv"],
		undefined,
		true,
	);
	const automatic = await enableAutomatic(f);
	const list = await f.catalog.list();
	expect(list.items).toHaveLength(1);
	expect(list.items[0]?.availableEpisodes).toBe(2);
	const work = required(list.items[0]);
	const review = required((await f.catalog.reviews()).items[0]);
	expect(review.decision).toBe("confirmed");
	expect(review.reason).toContain("Automatically identified");
	expect((await f.catalog.review(review.id)).associations[0]?.workId).toBe(
		work.id,
	);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: [
			{
				reviewId: review.id,
				revision: review.revision,
				targets: [{ kind: "regular", number: "3" }],
				reason: "Manual episode correction",
			},
		],
	});
	await f.catalog.confirm({
		previewId: preview.id,
		operationKey: "manual-over-auto",
		replace: true,
	});
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.review(review.id)).associations[0]?.number).toBe("3");
	expect((await f.catalog.list()).items[0]?.displayTitle).toBe(
		work.displayTitle,
	);
	await automatic.close();
	await f.restart();
	await f.scan();
	expect((await f.catalog.list()).items).toHaveLength(1);
	expect((await f.catalog.review(review.id)).associations[0]?.number).toBe("3");
});

test("ambiguous candidates, specials and provider failure remain pending rather than auto-associated", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - SP01.mkv"]);
	f.setData({
		...details(),
		titles: [{ value: "Anime", kind: "romaji", language: null }],
	});
	const results = f.automatic.getResults();
	for (const result of results) {
		result.metadataStatus = "searched";
		result.proposals = [
			{
				candidate: {
					work: {
						reference: project(f),
						snapshotId: "search",
						titles: ["Anime"],
						year: 2023,
						format: "TV",
						episodeCount: 12,
						season: null,
						part: null,
					},
					score: 70,
					reasons: [],
					conflicts: [],
					matcherVersion: "test",
				},
				mapping: {
					targets: [{ kind: "regular", number: "1" }],
					reasons: [],
					unresolved: [],
				},
			},
		];
	}
	const first = required(results[0]);
	const original = structuredClone(first.proposals[0]);
	if (!original) throw new Error("Missing proposal");
	first.proposals.push({
		...original,
		candidate: {
			...original.candidate,
			work: {
				...original.candidate.work,
				reference: project(f, "2"),
			},
			score: 69,
		},
	});
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	expect((await f.catalog.list()).items).toHaveLength(0);
	first.proposals = [original];
	first.metadataStatus = "failed";
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	expect((await f.catalog.list()).items).toHaveLength(0);
	first.metadataStatus = "searched";
	required(first.proposals[0]).candidate.conflicts = ["Year differs"];
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	expect((await f.catalog.list()).items).toHaveLength(0);
});

test("manual rejection and removal prevent later successful identification from re-admitting sources", async () => {
	const f = await fixture();
	const automatic = await enableAutomatic(f);
	const item = required((await f.catalog.reviews()).items[0]);
	await f.catalog.remove(item.id, item.revision, "Not this work");
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.review(item.id)).decision).toBe("rejected");
	expect((await f.catalog.list()).items).toHaveLength(0);
});

test("automatic hydration failure remains reviewable and a later scan can retry without duplicates", async () => {
	const f = await fixture();
	f.get.mockRejectedValueOnce(new Error("provider unavailable"));
	const automatic = await enableAutomatic(f);
	expect((await f.catalog.list()).items).toHaveLength(0);
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
	await f.scan();
	await automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("rejection accepts omitted or blank reasons, persists null, and keeps removal explicit", async () => {
	const info = vi.spyOn(logger, "info");
	const f = await fixture(undefined, undefined, true);
	let review = required((await f.catalog.reviews()).items[0]);
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	for (const reason of [undefined, "", "   "]) {
		const response = await app.inject({
			method: "POST",
			url: `/api/catalog/reviews/${review.id}/reject`,
			payload: {
				revision: review.revision,
				...(reason === undefined ? {} : { reason }),
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().reason).toBeNull();
		review = await f.catalog.review(review.id);
	}
	const tooLong = await app.inject({
		method: "POST",
		url: `/api/catalog/reviews/${review.id}/reject`,
		payload: { revision: review.revision, reason: "x".repeat(501) },
	});
	expect(tooLong.statusCode).toBe(400);
	await f.restart();
	expect((await f.catalog.review(review.id)).reason).toBeNull();
	await confirm(f);
	review = await f.catalog.review(review.id);
	await expect(
		f.catalog.reject(review.id, review.revision, ""),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await expect(
		f.catalog.remove(review.id, review.revision, ""),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	expect(
		info.mock.calls.filter(
			([record]) => (record as { event?: string }).event === "catalog.rejected",
		),
	).toHaveLength(3);
	await f.catalog.remove(review.id, review.revision, "private removal reason");
	expect(info).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "catalog.associations_removed",
			reviewId: review.id,
		}),
		expect.any(String),
	);
	expect(JSON.stringify(info.mock.calls)).not.toContain(
		"private removal reason",
	);
});

test("Review re-identification refreshes metadata, admits pending siblings and preserves manual rejection", async () => {
	const f = await fixture(["Recovered - 01.mkv", "Recovered - 02.mkv"]);
	const automatic = await enableAutomatic(f);
	const reviews = (await f.catalog.reviews({ decision: "pending" })).items;
	expect(reviews).toHaveLength(2);
	const item = required(
		reviews.find((row) => row.relativePath.endsWith("01.mkv")),
	);
	const rejected = required(reviews.find((row) => row.id !== item.id));
	await f.catalog.reject(
		rejected.id,
		rejected.revision,
		"Keep outside the library",
	);
	f.setData({
		...details(),
		titles: [{ value: "Recovered", kind: "romaji", language: null }],
	});
	const reidentify = vi.spyOn(automatic, "reidentify");
	const app = createHttpApp({
		catalog: f.catalog,
		identification: automatic,
		config: { host: "localhost", port: 80 },
		logger,
	});
	cleanups.push(() => app.close());
	const request = (id: string, revision: number) =>
		app.inject({
			method: "POST",
			url: `/api/catalog/reviews/${id}/reidentify`,
			payload: { revision },
		});
	expect((await request(item.id, item.revision + 1)).statusCode).toBe(409);
	expect(reidentify).not.toHaveBeenCalled();
	const response = await request(item.id, item.revision);
	expect(response.statusCode, response.body).toBe(200);
	expect(response.json()).toMatchObject({
		decision: "confirmed",
		metadataStatus: "searched",
		associations: [{ number: "1" }],
	});
	expect((await f.catalog.review(rejected.id)).decision).toBe("rejected");
	expect(
		(await request(rejected.id, (await f.catalog.review(rejected.id)).revision))
			.statusCode,
	).toBe(409);
	expect((await request(item.id, response.json().revision)).statusCode).toBe(
		409,
	);
	expect(reidentify).toHaveBeenCalledTimes(1);
});

test("bulk Review identification snapshots every pending page, deduplicates directories and returns before processing finishes", async () => {
	const f = await fixture([
		"first/Recovered - 01.mkv",
		"first/Recovered - 02.mkv",
		"second/Recovered - 03.mkv",
		"rejected/Recovered - 04.mkv",
		"missing/Recovered - 05.mkv",
	]);
	const automatic = await enableAutomatic(f);
	const initial = (await f.catalog.reviews()).items;
	const rejected = required(
		initial.find((item) => item.relativePath.startsWith("rejected/")),
	);
	await f.catalog.reject(rejected.id, rejected.revision, "Keep rejected");
	await rm(join(f.root, "missing/Recovered - 05.mkv"));
	f.setData({
		...details(),
		titles: [{ value: "Recovered", kind: "romaji", language: null }],
	});
	const read = f.catalog.reviews.bind(f.catalog);
	const pages = vi
		.spyOn(f.catalog, "reviews")
		.mockImplementation((options) => read({ ...options, perPage: 1 }));
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const identify = automatic.reidentify.bind(automatic);
	const forced = vi
		.spyOn(automatic, "reidentify")
		.mockImplementation(async (fileId) => {
			await gate;
			return identify(fileId);
		});
	const app = createHttpApp({
		catalog: f.catalog,
		identification: automatic,
		config: { host: "localhost", port: 80 },
		logger,
	});
	cleanups.push(() => app.close());
	const start = () =>
		app.inject({
			method: "POST",
			url: "/api/catalog/reviews/reidentify",
			payload: {},
		});
	const first = await start();
	expect(first.statusCode, first.body).toBe(202);
	expect(first.json().reviewRun).toMatchObject({ id: 1, state: "running" });
	const duplicate = await start();
	expect(duplicate.json().reviewRun.id).toBe(1);
	release();
	await expect
		.poll(() => automatic.getStatus().reviewRun?.state)
		.toBe("completed");
	expect(automatic.getStatus().reviewRun).toMatchObject({
		total: 3,
		processed: 3,
		identified: 3,
		pending: 0,
		failed: 0,
		skipped: 0,
	});
	expect(pages.mock.calls.map(([options]) => options?.page)).toEqual([1, 2, 3]);
	expect(forced).toHaveBeenCalledTimes(2);
	expect((await f.catalog.review(rejected.id)).decision).toBe("rejected");
});

test("bulk Review identification continues after one directory fails", async () => {
	const f = await fixture([
		"first/Recovered - 01.mkv",
		"second/Recovered - 02.mkv",
	]);
	const automatic = await enableAutomatic(f);
	f.setData({
		...details(),
		titles: [{ value: "Recovered", kind: "romaji", language: null }],
	});
	const publish = f.catalog.publish.bind(f.catalog);
	vi.spyOn(f.catalog, "publish").mockImplementation((results, ...args) => {
		if (
			results.some((result) => result.source.relativePath.startsWith("first/"))
		)
			return Promise.reject(new Error("Directory publication failed"));
		return publish(results, ...args);
	});
	automatic.reidentifyPending();
	await expect
		.poll(() => automatic.getStatus().reviewRun?.state)
		.toBe("completed");
	expect(automatic.getStatus().reviewRun).toMatchObject({
		total: 2,
		processed: 2,
		identified: 1,
		failed: 1,
	});
});
