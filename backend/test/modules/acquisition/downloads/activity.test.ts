import { expect, test } from "vitest";

import {
	fixture,
	key,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("download activity paginates one work with stable ordering and summaries across every page", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	const records = [original];
	for (let index = 0; index < 25; index++) {
		const item = {
			...original,
			id: `page-${String(index).padStart(2, "0")}`,
			hash: `unresolved:page-${index}`,
			episode: index + 100,
			candidateId: `candidate-${index}`,
			createdAt: original.createdAt + Math.floor(index / 2),
			state: index % 2 ? ("blocked" as const) : ("available" as const),
			error: index % 2 ? "test_failure" : null,
		};
		expect(f.db.acquisitionDownloads.reserve(item)).toBe(true);
		records.push(item);
	}
	expect(
		f.db.acquisitionDownloads.reserve({
			...original,
			id: "foreign",
			workKey: "anilist:anime:2",
			hash: "unresolved:foreign",
		}),
	).toBe(true);
	const newestFirst = [...records].sort(
		(a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
	);
	const expected = [
		...newestFirst.filter((item) => item.error),
		original,
		...newestFirst.filter((item) => !item.error && item.id !== original.id),
	];
	const pages = [1, 2, 3, 4].map((page) =>
		f.db.acquisitionDownloads.activity(key, page, 7),
	);
	expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(
		expected.map((item) => item.id),
	);
	for (const page of pages) {
		expect(page).toMatchObject({ total: 26, active: 1, attention: 12 });
		expect(page.candidateIds).toHaveLength(26);
	}
	expect(f.worker.activity(key, 2).items).toHaveLength(6);
	expect(
		f.db.acquisitionDownloads.activity("anilist:anime:999", 1, 20),
	).toEqual({ items: [], total: 0, active: 0, attention: 0, candidateIds: [] });
});

test("worker queries use bounded cursors, retain reservations and redact only expired terminal evidence", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	const original = f.db.acquisitionDownloads.activity(key, 1, 100).items[0];
	if (!original) throw new Error();
	const states = [
		"bound",
		"available",
		"pending",
		"unknown",
		"missing",
		"blocked",
	] as const;
	for (const [index, state] of states.entries()) {
		f.db.acquisitionDownloads.reserve({
			...original,
			id: `!batch-${index}`,
			hash: `unresolved:!batch-${index}`,
			episode: index + 100,
			state,
			nextAttemptAt: index === 2 ? original.updatedAt + 1000 : 0,
		});
	}
	const batch = f.db.acquisitionDownloads.workBatch("", 2, original.updatedAt);
	expect(batch.map((item) => item.id)).toEqual(["!batch-0", "!batch-3"]);
	const next = f.db.acquisitionDownloads.workBatch(
		"!batch-3",
		2,
		original.updatedAt,
	);
	expect(next.map((item) => item.id)).toEqual([original.id]);
	expect(f.db.acquisitionDownloads.hasActive()).toBe(true);
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 104)).toBe(true);
	expect(
		f.db.acquisitionDownloads.hashOwner("unresolved:!batch-4", "other"),
	).toBe(true);
	expect(
		f.db.acquisitionDownloads.hashOwner("unresolved:!batch-4", "!batch-4"),
	).toBe(false);
	f.db.acquisitionDownloads.prune(original.updatedAt + 1);
	expect(f.db.acquisitionDownloads.intent("!batch-1")).toMatchObject({
		source: "",
		title: "",
		transfer: null,
		error: null,
		state: "available",
	});
	expect(f.db.acquisitionDownloads.intent("!batch-4")).toMatchObject({
		source: "",
		state: "missing",
	});
	expect(f.db.acquisitionDownloads.intent("!batch-5")?.source).toBe(
		original.source,
	);
	expect(f.db.acquisitionDownloads.reservedEpisode(key, 104)).toBe(true);
	expect(
		f.db.acquisitionDownloads.reserve({
			...original,
			id: "duplicate",
			hash: "another",
			episode: 104,
		}),
	).toBe(false);
});

test("Activity keeps older active work on the first page instead of burying it under completed history", async () => {
	const f = await fixture();
	await f.configure();
	await f.authorize();
	await f.worker.tick();
	const id = f.worker.activity(key).items[0]?.id;
	if (!id) throw Error("Missing download");
	const original = f.db.acquisitionDownloads.intent(id);
	if (!original) throw Error("Missing intent");
	for (let i = 0; i < 25; i++)
		f.db.acquisitionDownloads.reserve({
			...original,
			id: `history-${i}`,
			hash: `history-${i}`,
			candidateId: `history-candidate-${i}`,
			episode: 100 + i,
			state: "available",
			ingestion: "available",
			createdAt: original.createdAt + i + 1,
		});
	expect(f.worker.activity(key).items[0]?.id).toBe(id);
	expect(f.worker.activity(key).total).toBe(26);
});
