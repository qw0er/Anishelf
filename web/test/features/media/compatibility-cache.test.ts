import { expect, test } from "vitest";
import { CompatibilityCache } from "../../../src/features/media/media-compatibility/cache.js";
import type { CompatibilityResult } from "../../../src/shared/api/contracts.js";

function result(fileId: string, sourceVersion = "v1"): CompatibilityResult {
	return {
		fileId,
		sourceVersion,
		direct: { status: "supported", reason: "browser-supported" },
	} as CompatibilityResult;
}
function fixture() {
	let saved: unknown = [];
	return {
		read: async () => structuredClone(saved),
		write: async (value: unknown) => {
			saved = structuredClone(value);
		},
		clear: async () => {
			saved = [];
		},
	};
}
test("persists complete results across cache instances without time expiry and replaces each file version", async () => {
	const storage = fixture();
	const first = new CompatibilityCache(storage);
	await first.save(result("file"));
	const reopened = new CompatibilityCache(storage);
	const cached = await reopened.read("file", "v1");
	expect(cached).toEqual(result("file"));
	if (!cached) throw new Error("Missing cache");
	cached.direct.status = "unsupported";
	expect((await reopened.read("file", "v1"))?.direct.status).toBe("supported");
	await reopened.save(result("file", "v2"));
	expect(await reopened.read("file", "v1")).toBeNull();
	expect(await new CompatibilityCache(storage).read("file", "v2")).toEqual(
		result("file", "v2"),
	);
	await reopened.remove("file");
	expect(await new CompatibilityCache(storage).read("file", "v2")).toBeNull();
});
test("unknown results are retryable and LRU storage is bounded by count and bytes", async () => {
	const storage = fixture(),
		cache = new CompatibilityCache(storage);
	await cache.save({
		...result("unknown"),
		direct: { status: "unknown", reason: "missing-evidence" },
	});
	expect(await cache.read("unknown", "v1")).toBeNull();
	// A single oversized result cannot evict ordinary cached results or grow disk storage.
	await cache.save(result("keep"));
	await cache.save(result("huge", "x".repeat(9 * 1024 * 1024)));
	expect(await cache.read("keep", "v1")).not.toBeNull();
	for (let index = 0; index < 1000; index++)
		await cache.save(result(`file-${index}`));
	expect(await cache.read("keep", "v1")).toBeNull();
	expect(await cache.read("file-999", "v1")).not.toBeNull();
	expect(((await storage.read()) as unknown[]).length).toBe(1000);
});
test("clearing during a slow restore cannot restore old results and storage failures are best effort", async () => {
	let release!: (value: unknown) => void;
	const cache = new CompatibilityCache({
		read: () =>
			new Promise((resolve) => {
				release = resolve;
			}),
		write: async () => {},
		clear: async () => {},
	});
	await cache.clear();
	release([["old", { value: result("old") }]]);
	expect(await cache.read("old", "v1")).toBeNull();
	const unavailable = new CompatibilityCache({
		read: async () => {
			throw new Error("Disabled IndexedDB");
		},
		write: async () => {
			throw new Error("Quota exceeded");
		},
		clear: async () => {
			throw new Error("Disabled IndexedDB");
		},
	});
	await unavailable.save(result("file"));
	expect(await unavailable.read("file", "v1")).toEqual(result("file"));
	await unavailable.clear();
	expect(await unavailable.read("file", "v1")).toBeNull();
});
