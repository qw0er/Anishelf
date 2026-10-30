import { expect, test, vi } from "vitest";
import type { MetadataProvider } from "../../../../src/modules/anime/metadata/ports.js";
import { resourceRootId } from "../../../../src/modules/resources/resource-access/domain/identity.js";

import {
	confirm,
	details,
	fixture,
	project,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("closing Catalog stops every composed use case before reading or mutating state", async () => {
	const f = await fixture();
	const committed = await confirm(f);
	const selected = await rows(f);
	const row = required(selected[0]);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: selected,
	});
	const before = f.database.catalog.work(committed.workId);
	const providerCalls = f.get.mock.calls.length;
	f.catalog.close();
	f.catalog.close();

	await expect(
		f.catalog.publish([], [resourceRootId(f.root)]),
	).rejects.toThrowError(
		expect.objectContaining({ code: "CATALOG_UNAVAILABLE" }),
	);
	const calls = [
		() => f.catalog.list(),
		() => f.catalog.getLocalWorkDetail(committed.workId),
		() => f.catalog.reviews(),
		() => f.catalog.fileReviews([]),
		() => f.catalog.preview({ reference: project(f), rows: selected }),
		() =>
			f.catalog.confirm({
				operationKey: "closed",
				previewId: preview.id,
				replace: true,
			}),
		() => f.catalog.reject(row.reviewId, row.revision, "Rejected"),
		() => f.catalog.remove(row.reviewId, row.revision, "Removed"),
		() =>
			f.catalog.editEpisode(
				committed.workId,
				"unused",
				committed.revision,
				"1",
				"Changed",
			),
		() => f.catalog.refresh(committed.workId, committed.revision),
	];
	for (const call of calls)
		await expect(call()).rejects.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
	expect(f.database.catalog.work(committed.workId)).toEqual(before);
	expect(f.database.catalog.operation("closed")).toBeNull();
	expect(f.get.mock.calls).toHaveLength(providerCalls);
});

test("quiescing cancels automatic refresh and prevents later catalog writes or timer requests", async () => {
	const f = await fixture();
	f.setData({ ...details(), status: "RELEASING" });
	const result = await confirm(f);
	const before = await f.catalog.getLocalWorkDetail(result.workId);
	vi.spyOn(Date, "now").mockReturnValue(
		before.metadata.fetchedAt + 25 * 60 * 60_000,
	);
	let complete:
		| ((value: Awaited<ReturnType<MetadataProvider["get"]>>) => void)
		| undefined;
	f.get.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	await f.catalog.getLocalWorkDetail(result.workId);
	await vi.waitFor(() => expect(complete).toBeDefined());
	await f.catalog.quiesce();
	required(complete)({
		data: { ...details(), description: "Too late" },
	});
	await Promise.resolve();
	expect(f.publicMetadata.current(project(f))?.snapshotId).toBe(
		before.metadata.snapshotId,
	);
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).metadata.refreshing,
	).toBe(false);
	expect(f.get).toHaveBeenCalledTimes(2);
});
