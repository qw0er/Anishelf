import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import {
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

test("published scans create durable reviews, and confirmation establishes a local library", async () => {
	const f = await fixture(["Season/Anime - 01.mkv", "Season/Anime - 02.mkv"]);
	const reviews = await f.catalog.reviews();
	expect(reviews.items).toHaveLength(2);
	expect(
		reviews.items.every(
			(item) => item.available && item.decision === "pending",
		),
	).toBe(true);
	expect(JSON.stringify(reviews)).not.toContain(f.root);
	expect((await f.catalog.list()).items).toEqual([]);
	const result = await confirm(f, rows(f, ["1", "2"]));
	expect(result.workId).not.toBe("1");
	const list = await f.catalog.list();
	expect(list.items).toHaveLength(1);
	expect(list.items[0]?.availableEpisodes).toBe(2);
	const detail = await f.catalog.getLocalWorkDetail(result.workId);
	expect(
		detail.episodes
			.filter((item) => item.versions.length)
			.map((item) => item.number),
	).toEqual(["1", "2"]);
	expect(
		detail.episodes.filter((item) => item.provenance === "count-derived"),
	).toHaveLength(10);
	expect(detail.episodes[2]?.availability).toBe("missing");
	expect(
		detail.episodes
			.filter((item) => item.versions.length)
			.every((item) => item.versions[0]?.available),
	).toBe(true);
	expect(detail.metadata.data.description).toBe("Original provider text");
	expect(await readFile(join(f.root, "Season/Anime - 01.mkv"), "utf8")).toBe(
		"original",
	);
});

test("confirmation operation keys survive restart and cannot be reused for different input", async () => {
	const info = vi.spyOn(logger, "info");
	const debug = vi.spyOn(logger, "debug");
	const f = await fixture(undefined, undefined, true);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	const request = {
		operationKey: "retry-key",
		previewId: preview.id,
		replace: false,
	};
	const result = await f.catalog.confirm(request);
	await f.restart();
	expect(await f.catalog.confirm(request)).toEqual(result);
	await expect(
		f.catalog.confirm({ ...request, replace: true }),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.list()).items).toHaveLength(1);
	expect(
		info.mock.calls.filter(
			([record]) =>
				(record as { event?: string }).event === "catalog.confirmed",
		),
	).toHaveLength(1);
	expect(debug).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "catalog.confirmation_reused",
			workId: result.workId,
		}),
		expect.any(String),
	);
});

test("stale review and work revisions block confirmation and explicit replacement previews affected links", async () => {
	const f = await fixture();
	const selected = await rows(f);
	const first = await f.catalog.preview({
		reference: project(f),
		rows: selected,
	});
	const stale = await f.catalog.preview({
		reference: project(f),
		rows: selected,
	});
	const confirmed = await f.catalog.confirm({
		operationKey: "first",
		previewId: first.id,
		replace: false,
	});
	await expect(
		f.catalog.confirm({
			operationKey: "stale",
			previewId: stale.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const second = await f.catalog.preview({
		reference: project(f, "2"),
		rows: await rows(f, ["2"]),
	});
	expect(second.rows[0]?.before[0]?.workId).toBe(confirmed.workId);
	await expect(
		f.catalog.confirm({
			operationKey: "replace",
			previewId: second.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const replacement = await f.catalog.confirm({
		operationKey: "replace-explicit",
		previewId: second.id,
		replace: true,
	});
	expect(replacement.workId).not.toBe(confirmed.workId);
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("atomic confirmation rolls back all associations and decisions when a later row fails", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f, ["1", "2"]),
	});
	const original = f.database.catalog.transaction.bind(f.database.catalog);
	vi.spyOn(f.database.catalog, "transaction").mockImplementation((operation) =>
		original((store) => {
			const decide = store.decide.bind(store);
			let calls = 0;
			store.decide = (...args) => {
				if (++calls === 2) throw new Error("simulated disk write failure");
				return decide(...args);
			};
			return operation(store);
		}),
	);
	await expect(
		f.catalog.confirm({
			operationKey: "atomic",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toThrow("simulated disk write failure");
	expect((await f.catalog.list()).items).toEqual([]);
	expect(
		(await f.catalog.reviews()).items.every(
			(item) => item.decision === "pending",
		),
	).toBe(true);
	for (const item of (await f.catalog.reviews()).items)
		expect(f.database.catalog.associations(item.id)).toEqual([]);
});

test("preview expiry requires a new preview without keeping transient snapshots pinned", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	vi.spyOn(Date, "now").mockReturnValue(preview.expiresAt + 1);
	await expect(
		f.catalog.confirm({
			operationKey: "expired",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	f.setData({ ...details(), description: "New current information" });
	await f.publicMetadata.get(project(f), { refresh: true });
	f.database.metadata.prune(0, 0);
	expect(f.database.metadata.get(preview.metadata.snapshotId)).toBeNull();
});

test("separate confirmations reuse provider identity and disjoint stale previews cannot overwrite corrections", async () => {
	const f = await fixture(["Anime - 01.mkv", "Anime - 02.mkv"]);
	const selected = await rows(f, ["1", "2"]);
	const first = await confirm(f, Promise.resolve([required(selected[0])]));
	const pending = required(
		(await f.catalog.reviews({ decision: "pending" })).items[0],
	);
	const request = {
		reference: project(f),
		rows: [
			{
				reviewId: pending.id,
				revision: pending.revision,
				targets: [{ kind: "regular" as const, number: "2" }],
				reason: "Second source",
			},
		],
	};
	const stale = await f.catalog.preview(request);
	const editedEpisode = required(
		(await f.catalog.getLocalWorkDetail(first.workId)).episodes[0],
	);
	await f.catalog.editEpisode(
		first.workId,
		editedEpisode.id,
		first.revision,
		editedEpisode.number,
		"Corrected episode",
	);
	await expect(
		f.catalog.confirm({
			operationKey: "disjoint-stale",
			previewId: stale.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const fresh = await f.catalog.preview(request);
	const second = await f.catalog.confirm({
		operationKey: "second-source",
		previewId: fresh.id,
		replace: false,
	});
	expect(second.workId).toBe(first.workId);
	expect((await f.catalog.list()).items).toHaveLength(1);
	expect((await f.catalog.getLocalWorkDetail(first.workId)).work).toMatchObject(
		{
			availableRegularEpisodes: 2,
		},
	);
});

test("confirmation fails safely if unconfirmed metadata was evicted after preview", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	f.setData({ ...details(), description: "New current information" });
	await f.publicMetadata.get(project(f), { refresh: true });
	f.database.metadata.prune(0, 0);
	await expect(
		f.catalog.confirm({
			operationKey: "evicted",
			previewId: preview.id,
			replace: false,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	expect((await f.catalog.list()).items).toEqual([]);
});

test("concurrent confirmation retries share one result and retain confirmed decision evidence", async () => {
	const f = await fixture();
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	const request = {
		operationKey: "concurrent",
		previewId: preview.id,
		replace: false,
	};
	const results = await Promise.all([
		f.catalog.confirm(request),
		f.catalog.confirm(request),
	]);
	expect(results[0]).toEqual(results[1]);
	f.setData({ ...details(), description: "New snapshot" });
	const detail = await f.catalog.getLocalWorkDetail(
		required(results[0]).workId,
	);
	await f.catalog.refresh(detail.work.id, detail.work.revision);
	f.database.metadata.prune(0, 0);
	expect(f.publicMetadata.snapshot(preview.metadata.snapshotId).data).toEqual(
		preview.metadata.data,
	);
	expect(
		(await f.catalog.getLocalWorkDetail(detail.work.id)).metadata.data
			.description,
	).toBe("New snapshot");
});
