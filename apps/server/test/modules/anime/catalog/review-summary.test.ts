import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AnimeCatalogApplication } from "../../../../src/modules/anime/anime-catalog/application/catalog.js";
import { createHttpApp } from "../../../support/http.js";
import { updateResourceSettings } from "../../../support/settings.js";
import {
	cleanups,
	confirm,
	fixture,
	logger,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("reviewSummary tracks pending available reviews across decisions, rescans, and root availability", async () => {
	const f = await fixture([
		"Anime - 01.mkv",
		"Anime - 02.mkv",
		"Anime - 03.mkv",
	]);
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 3 });

	const firstBatch = await f.catalog.reviews({ decision: "pending" });
	const rejected = required(firstBatch.items[0]);
	await f.catalog.reject(rejected.id, rejected.revision, "Not anime");
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 2 });

	const nextRow = required((await rows(f, ["1", "2", "3"]))[1]);
	await confirm(f, Promise.resolve([nextRow]));
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 1 });

	const remaining = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	);
	await rm(join(f.root, remaining.relativePath));
	await f.scan();
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 0 });
});

test("reviewSummary returns 0 when sources are unpublished, unconfigured, or lack a snapshot", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 2 });

	const withoutSnapshot = new AnimeCatalogApplication({
		store: f.database.catalog,
		metadata: f.publicMetadata,
		sources: { ...f.library.sources, hasSnapshot: false },
		logger,
	});
	cleanups.push(async () => {
		await withoutSnapshot.quiesce();
		withoutSnapshot.close();
	});
	expect(await withoutSnapshot.reviewSummary()).toEqual({ pending: 0 });

	const scope = await f.library.sources.getScope();
	await f.catalog.publish([], scope.ids);
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 0 });

	await f.catalog.publish(f.automatic.getResults(), scope.ids);
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 2 });

	await updateResourceSettings(f.library, { resourceRoots: [] });
	expect(await f.catalog.reviewSummary()).toEqual({ pending: 0 });
});

test("GET /api/catalog/reviews/summary returns pending count with no-store caching", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());

	const initial = await app.inject({
		method: "GET",
		url: "/api/catalog/reviews/summary",
	});
	expect(initial.statusCode).toBe(200);
	expect(initial.headers["cache-control"]).toBe("no-store");
	expect(initial.json()).toEqual({ pending: 2 });

	const item = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	);
	await f.catalog.reject(item.id, item.revision, "Ignored");

	const updated = await app.inject({
		method: "GET",
		url: "/api/catalog/reviews/summary",
	});
	expect(updated.statusCode).toBe(200);
	expect(updated.headers["cache-control"]).toBe("no-store");
	expect(updated.json()).toEqual({ pending: 1 });
});
