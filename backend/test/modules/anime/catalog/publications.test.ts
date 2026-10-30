import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { resourceRootId } from "../../../../src/modules/resources/resource-access/domain/identity.js";
import { DomainError } from "../../../../src/shared/errors.js";
import { updateResourceSettings } from "../../../support/settings.js";

import {
	confirm,
	fixture,
	project,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("rejection survives repeat scans and removal does not erase source history", async () => {
	const f = await fixture(undefined, undefined, true);
	let review = required((await f.catalog.reviews()).items[0]);
	await f.catalog.reject(review.id, review.revision, "Wrong title");
	await f.scan();
	await f.restart();
	review = required(
		(await f.catalog.reviews({ decision: "rejected" })).items[0],
	);
	expect(review.reason).toBe("Wrong title");
	const result = await confirm(f);
	review = required((await f.catalog.reviews()).items[0]);
	f.database.playback.openGeneration(review.sourceId);
	await expect(
		f.catalog.reject(review.id, review.revision, "Reject"),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await f.catalog.remove(review.id, review.revision, "Remove association");
	expect((await f.catalog.list()).items).toEqual([]);
	expect(f.database.playback.get(review.sourceId)).toBeDefined();
	expect(f.database.catalog.work(result.workId)).not.toBeNull();
});

test("replaced sources require new confirmation and missing files retain unavailable historical links", async () => {
	const f = await fixture();
	const result = await confirm(f);
	const before = required(
		required((await f.catalog.getLocalWorkDetail(result.workId)).episodes[0])
			.versions[0],
	);
	await writeFile(
		join(f.root, "Anime - 01.mkv"),
		"replacement with different size",
	);
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).episodes[0]?.versions[0]
			?.available,
	).toBe(false);
	await f.scan();
	const reviews = await f.catalog.reviews();
	expect(reviews.items).toHaveLength(2);
	expect(
		reviews.items.find((item) => item.id === before.reviewId)?.available,
	).toBe(false);
	expect(
		reviews.items.find((item) => item.id !== before.reviewId)?.decision,
	).toBe("pending");
	expect(
		(await f.catalog.list({ availability: "unavailable" })).items[0]?.id,
	).toBe(result.workId);
	await rm(join(f.root, "Anime - 01.mkv"));
	await f.scan();
	expect(
		(await f.catalog.getLocalWorkDetail(result.workId)).work.availableEpisodes,
	).toBe(0);
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("changed files and root switches invalidate pending previews without deleting other roots", async () => {
	const f = await fixture();
	const initial = await confirm(f);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	await writeFile(join(f.root, "Anime - 01.mkv"), "changed");
	await expect(
		f.catalog.confirm({
			operationKey: "changed",
			previewId: preview.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	const otherRoot = join(f.base, "other");
	await mkdir(otherRoot);
	await updateResourceSettings(f.library, { resourceRoots: [otherRoot] });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toEqual([]);
	await expect(
		f.catalog.getLocalWorkDetail(initial.workId),
	).rejects.toMatchObject({
		code: "CATALOG_NOT_FOUND",
	});
	await expect(
		f.catalog.confirm({
			operationKey: "root",
			previewId: preview.id,
			replace: true,
		}),
	).rejects.toMatchObject({ code: "CATALOG_CONFLICT" });
	await updateResourceSettings(f.library, { resourceRoots: [f.root] });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect((await f.catalog.list()).items).toHaveLength(1);
});

test("root epoch conflicts remain visible rather than being disguised as unavailable sources", async () => {
	const f = await fixture();
	const result = await confirm(f);
	vi.spyOn(f.library.sources, "revalidateSource").mockImplementation(
		async () => {
			throw new DomainError("INTERNAL_ERROR", "unexpected storage fault");
		},
	);
	await expect(
		f.catalog.getLocalWorkDetail(result.workId),
	).rejects.toMatchObject({
		code: "INTERNAL_ERROR",
	});
});

test("Catalog queries and complete publications use opaque scope collections", async () => {
	const f = await fixture();
	const result = required(f.automatic.getResults()[0]);
	const otherScope = resourceRootId("/another-library");
	const otherResult = structuredClone(result);
	otherResult.source.scopeId = otherScope;
	const source = f.database.catalog.registerSource(otherResult.source);
	f.database.catalog.publish([otherScope], [{ source, result: otherResult }]);
	const currentScope = result.source.scopeId;
	const reviews = f.database.catalog.reviews(
		[currentScope, otherScope],
		undefined,
		1,
		100,
	);
	expect(reviews.items.map((item) => item.rootId)).toEqual(
		expect.arrayContaining([currentScope, otherScope]),
	);
	f.database.catalog.publish([currentScope], []);
	expect(f.database.catalog.review(source.id)?.available).toBe(true);
	f.database.catalog.publish([currentScope, otherScope], []);
	expect(f.database.catalog.review(source.id)?.available).toBe(false);
	expect(f.database.catalog.reviews([], undefined, 1, 100).items).toEqual([]);
});

test("multi-root versions preserve confirmed associations through removal and restoration", async () => {
	const f = await fixture(undefined, undefined, true);
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: await rows(f),
	});
	const confirmed = await f.catalog.confirm({
		operationKey: "multi-first",
		previewId: preview.id,
		replace: false,
	});
	const original = required((await f.catalog.reviews()).items[0]);

	await f.restart();
	expect((await f.catalog.review(original.id)).decision).toBe("confirmed");
	const other = join(f.base, "another-disk");
	await mkdir(other);
	await writeFile(join(other, "Anime - 01.mkv"), "another copy");
	await updateResourceSettings(f.library, { resourceRoots: [f.root, other] });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	const second = required(
		(await f.catalog.reviews()).items.find(
			(item) => item.rootId !== original.rootId,
		),
	);
	expect(second.fileId).not.toBe(original.fileId);
	const extra = await f.catalog.preview({
		reference: project(f),
		rows: [
			{
				reviewId: second.id,
				revision: second.revision,
				targets: [{ kind: "regular", number: "1" }],
				reason: "Second resource directory copy",
			},
		],
	});
	await f.catalog.confirm({
		operationKey: "multi-second",
		previewId: extra.id,
		replace: false,
	});
	const versions = async () =>
		(await f.catalog.getLocalWorkDetail(confirmed.workId)).episodes.find(
			(episode) => episode.number === "1",
		)?.versions;
	expect(await versions()).toHaveLength(2);
	await updateResourceSettings(f.library, { resourceRoots: [other] });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect(await versions()).toHaveLength(1);
	await updateResourceSettings(f.library, { resourceRoots: [other, f.root] });
	await f.library.waitForCompletion();
	await f.automatic.waitForCompletion();
	expect(await versions()).toHaveLength(2);
	expect((await f.catalog.review(original.id)).decision).toBe("confirmed");
});

test("scoped publications retain unrelated decisions, associations and playback history", async () => {
	const f = await fixture(["series/Anime - 01.mkv", "other/Anime - 02.mkv"]);
	const before = (await f.catalog.reviews()).items;
	const changed = required(
		before.find((item) => item.relativePath.startsWith("series/")),
	);
	const untouched = required(before.find((item) => item.id !== changed.id));
	await f.catalog.reject(untouched.id, untouched.revision, "Manual decision");
	f.database.playback.openGeneration(changed.sourceId);
	const previous = f.database.catalog.associations(changed.sourceId);
	await f.catalog.publish(
		[],
		(await f.library.sources.getScope()).ids,
		undefined,
		[changed.fileId],
	);
	const retained = f.database.catalog.review(untouched.id);
	expect(retained).toMatchObject({
		available: true,
		decision: "rejected",
		reason: "Manual decision",
	});
	expect(f.database.catalog.review(changed.id)?.available).toBe(false);
	expect(f.database.catalog.associations(changed.sourceId)).toEqual(previous);
	expect(f.database.playback.get(changed.sourceId)).toBeDefined();
});

test.each(["move", "delete"] as const)(
	"confirmed resource %s preserves Catalog decisions and playback records",
	async (action) => {
		const f = await fixture(["Season/Anime - 01.mkv"]);
		await confirm(f);
		const review = required((await f.catalog.reviews()).items[0]);
		f.database.playback.openGeneration(review.sourceId);
		const associations = f.database.catalog.associations(review.sourceId);
		const progress = f.database.playback.get(review.sourceId);
		const input = {
			id: review.fileId,
			action,
			...(action === "move" ? { destinationId: "root" } : {}),
		};
		await f.library.commands.execute(input);
		await f.automatic.waitForCompletion();
		expect(f.database.catalog.associations(review.sourceId)).toEqual(
			associations,
		);
		expect(f.database.catalog.review(review.id)).toMatchObject({
			decision: "confirmed",
			available: false,
		});
		expect(f.database.playback.get(review.sourceId)).toEqual(progress);
	},
);
