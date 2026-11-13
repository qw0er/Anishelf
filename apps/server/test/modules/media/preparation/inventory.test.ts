import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	PreparedMediaDeleteResponse,
	PreparedMediaList,
} from "@anishelf/contracts/http";
import { expect, test, vi } from "vitest";
import { PreparedMediaFiles } from "../../../../src/modules/media/artifacts/files.js";
import {
	completed,
	fixture,
	headers,
	required,
	setupTestLifecycle,
	taskId,
} from "./support/preparation-fixture.js";

setupTestLifecycle();

async function ready() {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	return { f, task, artifactId: required(task.artifactId) };
}
async function inventory(f: Awaited<ReturnType<typeof fixture>>, query = "") {
	const response = await f.app.inject({
		url: `/api/prepared-media${query}`,
		headers,
	});
	expect(response.statusCode).toBe(200);
	expect(response.headers["cache-control"]).toBe("no-store");
	return response.json<PreparedMediaList>();
}

test("inventory lists artifacts beyond task limits with stable paging, filtering, sorting and unfiltered usage", async () => {
	const { f, task, artifactId } = await ready();
	const original = required(f.database.preparation.get(task.id));
	const artifact = required(f.database.preparation.artifact(artifactId));
	for (let index = 0; index < 52; index++) {
		const id = createHash("sha256").update(String(index)).digest("hex");
		const copy = {
			...structuredClone(original),
			id: randomUUID(),
			filename: `Episode ${index}.mkv`,
			spec: { ...structuredClone(original.spec), executionPlanId: id },
			state: { ...original.state, updatedAtMs: index + 1 },
		};
		f.database.preparation.insert(copy);
		f.database.preparation.publish(copy, {
			...artifact,
			id,
			taskId: copy.id,
			sizeBytes: index + 1,
		});
		await writeFile(
			join(f.dataDir, "cache", "prepared-media", `${id}.media`),
			"x".repeat(index + 1),
		);
	}
	const first = await inventory(f);
	expect(first.items).toHaveLength(50);
	expect(first.total).toBe(53);
	expect(first.usage.count).toBe(53);
	expect(first.usage.copyBytes).toBe(10 + (52 * 53) / 2);
	expect(first.items[0]?.id).toBe(artifactId);
	const second = await inventory(f, "?page=2");
	expect(second.items).toHaveLength(3);
	expect(
		second.items.some((item) =>
			first.items.some((other) => other.id === item.id),
		),
	).toBe(false);
	const searched = await inventory(f, "?search=Episode%2051&status=ready");
	expect(searched.items.map((item) => item.filename)).toEqual([
		"Episode 51.mkv",
	]);
	expect(searched.usage).toEqual({
		...first.usage,
		availableBytes: expect.any(Number),
	});
	expect((await inventory(f, "?sort=size")).items[0]?.sizeBytes).toBe(52);
	expect((await inventory(f, "?search=not-found")).total).toBe(0);
	expect((await inventory(f, "?page=999")).page).toBe(2);
});

test("inventory is non-destructive when the output/source is missing or unverified and never probes", async () => {
	const { f, artifactId } = await ready();
	f.probe.mockClear();
	await rm(join(f.dataDir, "cache", "prepared-media", `${artifactId}.media`));
	const listing = await inventory(f, "?status=unavailable");
	expect(listing.items[0]?.status).toBe("unavailable");
	expect(f.database.preparation.artifact(artifactId)).toBeDefined();
	expect(f.probe).not.toHaveBeenCalled();
	const deleted = await f.app.inject({
		method: "DELETE",
		url: `/api/prepared-media/${artifactId}`,
		headers,
	});
	expect(deleted.statusCode).toBe(204);
	expect(f.database.preparation.artifact(artifactId)).toBeUndefined();
	expect(await readFile(f.sourcePath, "utf8")).toBe("source");
});

test("inventory and both deletion routes enforce resource scope membership", async () => {
	const { f, artifactId } = await ready();
	const originalScope = await f.library.sources.getScope();
	vi.spyOn(f.library.sources, "getScope").mockResolvedValue({
		...originalScope,
		ids: [],
	});
	expect((await inventory(f)).items).toEqual([]);
	expect(
		(
			await f.app.inject({
				method: "DELETE",
				url: `/api/prepared-media/${artifactId}`,
				headers,
			})
		).statusCode,
	).toBe(404);
	const batch = await f.app.inject({
		method: "POST",
		url: "/api/prepared-media/delete",
		headers,
		payload: { ids: [artifactId] },
	});
	expect(batch.json<PreparedMediaDeleteResponse>().results).toEqual([
		{ id: artifactId, error: "RESOURCE_NOT_FOUND" },
	]);
	expect(f.database.preparation.artifact(artifactId)).toBeDefined();
});

test("borrowed copies block deletion and batches report individual failures; release enables retry", async () => {
	const { f, artifactId } = await ready();
	const borrowed = await f.preparation.openArtifact(artifactId);
	expect((await inventory(f)).items[0]?.deleteBlockedReason).toBe("in-use");
	const missingId = "f".repeat(64);
	const batch = await f.app.inject({
		method: "POST",
		url: "/api/prepared-media/delete",
		headers,
		payload: { ids: [artifactId, missingId] },
	});
	expect(batch.json<PreparedMediaDeleteResponse>().results).toEqual([
		{ id: artifactId, error: "PREPARATION_BUSY" },
		{ id: missingId, error: "RESOURCE_NOT_FOUND" },
	]);
	await borrowed.release();
	const retry = await f.app.inject({
		method: "POST",
		url: "/api/prepared-media/delete",
		headers,
		payload: { ids: [artifactId, missingId] },
	});
	expect(retry.json<PreparedMediaDeleteResponse>().results).toEqual([
		{ id: artifactId, error: null },
		{ id: missingId, error: "RESOURCE_NOT_FOUND" },
	]);
	expect((await inventory(f)).usage.copyBytes).toBe(0);
	expect(await readFile(f.sourcePath, "utf8")).toBe("source");
});

test("filesystem deletion failures preserve retryable metadata and original media", async () => {
	const { f, artifactId } = await ready();
	const remove = vi
		.spyOn(PreparedMediaFiles.prototype, "remove")
		.mockRejectedValueOnce(new Error("disk failure"));
	const response = await f.app.inject({
		method: "DELETE",
		url: `/api/prepared-media/${artifactId}`,
		headers,
	});
	expect(response.statusCode).toBe(403);
	expect(response.json().error.code).toBe("RESOURCE_WRITE_FAILED");
	expect(f.database.preparation.artifact(artifactId)).toBeDefined();
	expect((await inventory(f)).usage.copyBytes).toBe(10);
	remove.mockRestore();
	await f.preparation.deleteArtifact(artifactId);
	expect((await inventory(f)).usage.copyBytes).toBe(0);
	expect(await readFile(f.sourcePath, "utf8")).toBe("source");
});

test("bulk deletion validates bounds and duplicates before executing", async () => {
	const f = await fixture();
	for (const ids of [
		[],
		["a".repeat(64), "a".repeat(64)],
		Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(64, "0")),
	]) {
		expect(
			(
				await f.app.inject({
					method: "POST",
					url: "/api/prepared-media/delete",
					headers,
					payload: { ids },
				})
			).statusCode,
		).toBe(400);
	}
});

test("budget usage includes invalidated borrowed files until the last reader releases", async () => {
	const { f, task, artifactId } = await ready();
	const borrowed = await f.preparation.openArtifact(artifactId);
	await writeFile(f.sourcePath, "replaced source");
	const before = await inventory(f);
	expect(before.items[0]?.status).toBe("unavailable");
	expect(f.database.preparation.artifact(artifactId)).toBeDefined();
	await f.preparation.get(task.id);
	const invalidated = await inventory(f);
	expect(invalidated.usage).toMatchObject({
		count: 0,
		copyBytes: 0,
		retainedBytes: 10,
	});
	await borrowed.release();
	expect((await inventory(f)).usage.retainedBytes).toBe(0);
});

test("active preparation blocks deletion and read/delete races cannot remove a borrowed copy", async () => {
	const { f, task, artifactId } = await ready();
	const persisted = required(f.database.preparation.get(task.id));
	f.database.preparation.save({
		...persisted,
		state: {
			status: "processing",
			failureReason: null,
			progress: null,
			updatedAtMs: Date.now(),
		},
	});
	expect((await inventory(f)).items[0]?.deleteBlockedReason).toBe("active");
	await expect(f.preparation.deleteArtifact(artifactId)).rejects.toMatchObject({
		code: "PREPARATION_BUSY",
	});
	f.database.preparation.save(persisted);
	const [opened, removed] = await Promise.allSettled([
		f.preparation.openArtifact(artifactId),
		f.preparation.deleteArtifact(artifactId),
	]);
	expect(opened.status).toBe("fulfilled");
	expect(removed.status).toBe("rejected");
	if (opened.status === "fulfilled") await opened.value.release();
	await f.preparation.deleteArtifact(artifactId);
});
