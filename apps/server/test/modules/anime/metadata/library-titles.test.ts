import { workKey } from "@anishelf/contracts/references";
import { afterEach, expect, test, vi } from "vitest";
import { MetadataLibraryTitles } from "../../../../src/modules/anime/external-works/metadata/application/library-titles.js";
import { metadataDefaults } from "../../../../src/modules/anime/external-works/metadata/defaults.js";
import type {
	CachedMetadata,
	MetadataTitle,
	WorkDetails,
} from "../../../../src/modules/anime/external-works/metadata/domain/model.js";
import type { ProviderReference } from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";

const native: MetadataTitle = {
	value: "Original",
	kind: "native",
	language: null,
};
const chinese: MetadataTitle = {
	value: "中文标题",
	kind: "alias",
	language: "zh-Hans",
};
const reference = (id = "1"): ProviderReference => ({
	provider: "anilist",
	mediaType: "anime",
	id,
});
const services: MetadataLibraryTitles[] = [];
afterEach(async () => {
	for (const service of services.splice(0)) await service.close();
});
async function settle() {
	// Flush load completion, PQueue's task lifecycle and the next serialized job.
	for (let index = 0; index < 10; index++) await Promise.resolve();
}
function fixture() {
	let now = 1_000_000;
	const titles = new Map<string, readonly MetadataTitle[]>();
	const attempts: {
		reference: ProviderReference;
		signal: AbortSignal;
		complete: (values: MetadataTitle[]) => void;
		fail: (error: Error) => void;
	}[] = [];
	const store = {
		titles: vi.fn(
			(references: readonly ProviderReference[]) =>
				new Map(
					references.flatMap((ref) => {
						const value = titles.get(workKey(ref));
						return value ? [[workKey(ref), value] as const] : [];
					}),
				),
		),
	};
	const load = vi.fn(
		(ref: ProviderReference, signal: AbortSignal) =>
			new Promise<CachedMetadata<WorkDetails>>((resolve, reject) => {
				const abort = () => reject(signal.reason);
				signal.addEventListener("abort", abort, { once: true });
				attempts.push({
					reference: ref,
					signal,
					complete: (values) => {
						signal.removeEventListener("abort", abort);
						titles.set(workKey(ref), values);
						resolve({
							data: {
								reference: { id: ref.id },
								titles: values,
							} as WorkDetails,
							snapshotId: `snapshot-${ref.id}`,
							fetchedAt: now,
							stale: false,
							refreshing: false,
							refreshError: null,
						});
					},
					fail: (error) => {
						signal.removeEventListener("abort", abort);
						reject(error);
					},
				});
			}),
	);
	const service = new MetadataLibraryTitles({ store, load, now: () => now });
	services.push(service);
	const attempt = (index = attempts.length - 1) => {
		const value = attempts[index];
		if (!value) throw new Error(`Expected title lookup attempt ${index}`);
		return value;
	};
	return {
		service,
		store,
		titles,
		load,
		attempts,
		attempt,
		advance: (duration: number) => {
			now += duration;
		},
	};
}

test("visible-title requests return immediately, deduplicate work and serialize lookups", async () => {
	const f = fixture();
	const first = reference(),
		second = reference("2");
	f.titles.set(workKey(first), [native]);
	expect(f.service.request([first, second], "chinese")).toBe(true);
	expect(f.service.cached([first]).get(workKey(first))).toEqual([native]);
	expect(f.load).toHaveBeenCalledTimes(1);
	expect(f.service.request([first, first, second], "chinese")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(1);
	f.attempt(0).complete([native, chinese]);
	await settle();
	expect(f.load).toHaveBeenCalledTimes(2);
	expect(f.attempt(1).reference).toEqual(second);
	f.attempt(1).complete([native, chinese]);
	await settle();
	expect(f.service.request([first, second], "chinese")).toBe(false);
	expect(f.load).toHaveBeenCalledTimes(2);
});

test("the visible-title queue admits at most 50 pending jobs", async () => {
	const f = fixture();
	const references = Array.from(
		{ length: metadataDefaults.titleMaximumPending + 10 },
		(_, index) => reference(String(index)),
	);
	expect(f.service.request(references, "chinese")).toBe(true);
	expect(f.service.request(references.slice(50), "chinese")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(1);
	for (let index = 0; index < metadataDefaults.titleMaximumPending; index++) {
		expect(f.load).toHaveBeenCalledTimes(index + 1);
		f.attempt(index).complete([native, chinese]);
		await settle();
	}
	expect(f.load).toHaveBeenCalledTimes(50);
	expect(f.service.request(references.slice(50), "chinese")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(51);
});

test("missing preferred titles wait 15 minutes before retrying", async () => {
	const f = fixture();
	const ref = reference();
	expect(f.service.request([ref], "chinese")).toBe(true);
	f.attempt().complete([native]);
	await settle();
	expect(f.service.request([ref], "chinese")).toBe(false);
	f.advance(15 * 60_000 - 1);
	expect(f.service.request([ref], "chinese")).toBe(false);
	f.advance(1);
	expect(f.service.request([ref], "chinese")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(2);
});

test("failed preferred-title requests wait one minute and retain cached titles", async () => {
	const f = fixture();
	const ref = reference();
	f.titles.set(workKey(ref), [native]);
	expect(f.service.request([ref], "chinese")).toBe(true);
	f.attempt().fail(new Error("Provider unavailable"));
	await settle();
	expect(f.service.cached([ref]).get(workKey(ref))).toEqual([native]);
	f.advance(60_000 - 1);
	expect(f.service.request([ref], "chinese")).toBe(false);
	f.advance(1);
	expect(f.service.request([ref], "chinese")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(2);
});

test("cooldowns are specific to the requested title preference", async () => {
	const f = fixture();
	const ref = reference();
	f.service.request([ref], "chinese");
	expect(f.service.request([ref], "english")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(1);
	f.attempt().complete([native]);
	await settle();
	expect(f.service.request([ref], "chinese")).toBe(false);
	expect(f.service.request([ref], "english")).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(2);
	f.attempt().complete([
		native,
		{ value: "English", language: "en", kind: "english" },
	]);
	await settle();
	expect(f.service.request([ref], "english")).toBe(false);
});

test("shutdown aborts active lookup and discards queued work", async () => {
	const f = fixture();
	f.service.request([reference(), reference("2")], "chinese");
	expect(f.load).toHaveBeenCalledTimes(1);
	await f.service.close();
	expect(f.attempt().signal.aborted).toBe(true);
	expect(f.load).toHaveBeenCalledTimes(1);
	expect(f.service.request([reference("3")], "chinese")).toBe(false);
});

test("latest cached target titles are used without scheduling a lookup", () => {
	const f = fixture();
	const ref = reference();
	expect(f.service.cached([ref]).get(workKey(ref))).toBeUndefined();
	f.titles.set(workKey(ref), [native, chinese]);
	expect(f.service.cached([ref]).get(workKey(ref))).toEqual([native, chinese]);
	expect(f.service.request([ref], "chinese")).toBe(false);
	expect(f.service.request([ref], "native")).toBe(false);
	expect(f.load).not.toHaveBeenCalled();
	expect(f.store.titles).toHaveBeenCalledTimes(4);
});
