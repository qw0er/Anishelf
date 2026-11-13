import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	fixture,
	required,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test.each(["missing", "replaced"] as const)(
	"%s sources leave the pending queue before and after scanning without losing history",
	async (state) => {
		const f = await fixture(undefined, undefined, true);
		const original = required((await f.catalog.reviews()).items[0]);
		const path = join(f.root, original.relativePath);
		if (state === "missing") await rm(path);
		else await writeFile(path, "replacement with a different size");

		expect(await f.catalog.reviews({ decision: "pending" })).toMatchObject({
			items: [],
			hasNextPage: false,
		});
		expect(await f.catalog.review(original.id)).toMatchObject({
			available: false,
			decision: "pending",
			revision: original.revision,
		});
		await f.scan();
		await f.restart();
		const pending = await f.catalog.reviews({ decision: "pending" });
		expect(pending.items.map((item) => item.id)).not.toContain(original.id);
		expect(pending.items).toHaveLength(state === "missing" ? 0 : 1);
		expect((await f.catalog.reviews()).items.map((item) => item.id)).toContain(
			original.id,
		);
	},
);

test("rediscovering the unchanged file restores its pending review without replacing the saved record", async () => {
	const f = await fixture();
	const original = required((await f.catalog.reviews()).items[0]);
	const scope = await f.library.sources.getScope();
	await f.catalog.publish([], scope.ids);
	expect((await f.catalog.reviews({ decision: "pending" })).items).toEqual([]);
	await f.catalog.publish(f.automatic.getResults(), scope.ids);
	expect((await f.catalog.reviews({ decision: "pending" })).items).toEqual([
		original,
	]);
});

test("temporarily unavailable roots hide pending reviews and restore them after recovery", async () => {
	const f = await fixture();
	const original = required((await f.catalog.reviews()).items[0]);
	const parked = join(f.base, "offline");
	await rename(f.root, parked);
	expect((await f.catalog.reviews({ decision: "pending" })).items).toEqual([]);
	await rename(parked, f.root);
	await f.scan();
	expect((await f.catalog.reviews({ decision: "pending" })).items).toEqual([
		original,
	]);
});

test("pending pagination fills pages across unavailable batches and excludes unavailable lookahead rows", async () => {
	const f = await fixture(
		Array.from({ length: 55 }, (_, index) => `Anime - ${index + 1}.mkv`),
	);
	const first = await f.catalog.reviews({ perPage: 50 });
	const rest = await f.catalog.reviews({ page: 2, perPage: 50 });
	const all = [...first.items, ...rest.items];
	const retained = all.slice(51, 54);
	for (const item of [...all.slice(0, 51), ...all.slice(54)])
		await rm(join(f.root, item.relativePath));

	const page = await f.catalog.reviews({ decision: "pending", perPage: 2 });
	expect(page.items.map((item) => item.id)).toEqual(
		retained.slice(0, 2).map((item) => item.id),
	);
	expect(page.hasNextPage).toBe(true);
	const next = await f.catalog.reviews({
		decision: "pending",
		perPage: 2,
		page: 2,
	});
	expect(next.items.map((item) => item.id)).toEqual([required(retained[2]).id]);
	expect(next.hasNextPage).toBe(false);
	expect(
		await f.catalog.reviews({ decision: "pending", perPage: 2, page: 3 }),
	).toMatchObject({ items: [], hasNextPage: false });

	await f.scan();
	const scope = await f.library.sources.getScope();
	expect(
		f.database.catalog
			.reviews(scope.ids, "pending", 1, 50)
			.items.map((item) => item.id),
	).toEqual(retained.map((item) => item.id));
});
