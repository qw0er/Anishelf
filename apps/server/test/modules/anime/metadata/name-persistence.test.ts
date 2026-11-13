import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { createMetadataModule } from "../../../../src/modules/anime/external-works/metadata/create.js";
import { metadataDefaults } from "../../../../src/modules/anime/external-works/metadata/defaults.js";
import type { ProjectDocument } from "../../../../src/modules/anime/external-works/metadata/domain/project-document.js";
import type { WorkDetails } from "../../../../src/modules/anime/external-works/metadata/domain/source-model.js";
import type { MetadataProvider } from "../../../../src/modules/anime/external-works/metadata/ports.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
function work(provider: string): WorkDetails {
	return {
		reference: { provider, mediaType: "anime", id: "1" },
		titles: [
			{ value: "Original", kind: "native", language: null },
			...(provider === "two"
				? [{ value: "中文标题", kind: "alias" as const, language: "zh-Hans" }]
				: []),
		],
		unavailableFields: [],
		year: 2026,
		format: "TV",
		status: "FINISHED",
		episodeCount: 12,
		startDate: { year: 2026, month: 1, day: 1 },
		endDate: null,
		airingSeason: null,
		nextAiringEpisode: null,
		coverUrl: null,
		bannerUrl: null,
		description: `${provider} original description`,
		genres: [],
		tags: [],
		studios: [],
		durationMinutes: null,
		country: null,
		source: null,
		averageScore: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable",
		siteUrl: null,
		providerUpdatedAt: null,
	};
}
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-name-proof-"));
	const data = [work("one"), work("two")];
	const get = vi.fn<MetadataProvider["get"]>(async (reference) => ({
		data: structuredClone(
			data.find((item) => item.reference.provider === reference.provider) ??
				data[0],
		) as WorkDetails,
	}));
	const search = vi.fn<MetadataProvider["search"]>();
	const providers: MetadataProvider[] = data.map((item) => ({
		capabilities: {
			key: item.reference.provider,
			version: "test",
			search: true,
			details: true,
			relations: false,
			airing: false,
			streamingLinks: false,
			canonicalEpisodes: false,
		},
		get,
		search: async (...args) => {
			await search(...args);
			return {
				data: {
					items: [structuredClone(item)],
					page: 1,
					perPage: 50,
					hasNextPage: false,
				},
			};
		},
		relations: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
		airing: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
	}));
	let database = ApplicationDatabase.open(directory);
	const build = () =>
		createMetadataModule({
			dataDir: directory,
			store: database.metadata,
			providers,
			defaultProvider: "one",
			artworkHosts: [],
			titleDisplayPreference: () => "chinese",
			logger: pino({ enabled: false }),
		});
	let metadata = await build();
	cleanup.push(async () => {
		await metadata.close();
		database.close();
		await rm(directory, { recursive: true, force: true });
	});
	return {
		data,
		get,
		search,
		get metadata() {
			return metadata;
		},
		get database() {
			return database;
		},
		restart: async () => {
			await metadata.close();
			database.close();
			database = ApplicationDatabase.open(directory);
			metadata = await build();
		},
	};
}

test("verified supplemental titles survive restart and cached reads without new provider requests", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("one:anime:1");
	const before = await f.metadata.get(reference);
	expect(before.data.displayTitle).toBe("中文标题");
	const calls = {
		get: f.get.mock.calls.length,
		search: f.search.mock.calls.length,
	};
	await f.restart();
	const current = f.metadata.current(reference);
	expect(current?.data.displayTitle).toBe("中文标题");
	expect(current?.snapshotId).toBe(before.snapshotId);
	const cached = await f.metadata.get(reference, { cachedOnly: true });
	expect(cached.data.displayTitle).toBe("中文标题");
	expect(cached.snapshotId).toBe(before.snapshotId);
	expect(f.get).toHaveBeenCalledTimes(calls.get);
	expect(f.search).toHaveBeenCalledTimes(calls.search);
	const external = { provider: "one", mediaType: "anime" as const, id: "1" };
	expect(
		f.database.metadata.titles([external]).get("one:anime:1"),
	).toContainEqual({ value: "中文标题", kind: "alias", language: "zh-Hans" });
});

test("refreshing unchanged origin evidence does not erase persisted names when verification is unavailable", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("one:anime:1");
	const before = await f.metadata.get(reference);
	await f.restart();
	f.search.mockRejectedValue(new Error("Offline"));
	const beforeOriginCalls = f.get.mock.calls.filter(
		([reference]) => reference.provider === "one",
	).length;
	const refreshed = await f.metadata.get(reference, { refresh: true });
	expect(refreshed.data.displayTitle).toBe("中文标题");
	expect(refreshed.data.description).toBe("one original description");
	expect(refreshed.snapshotId).toBe(before.snapshotId);
	expect(
		f.get.mock.calls.filter(([reference]) => reference.provider === "one")
			.length,
	).toBe(beforeOriginCalls + 1);
});

test("changed origin source evidence invalidates persisted names", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("one:anime:1");
	const before = await f.metadata.get(reference);
	await f.restart();
	const origin = f.data[0];
	if (!origin) throw new Error("Missing source fixture");
	origin.startDate = { year: 2027, month: 2, day: 1 };
	const changed = await f.metadata.get(reference, { refresh: true });
	expect(changed.data.displayTitle).toBe("Original");
	expect(changed.snapshotId).not.toBe(before.snapshotId);
	expect(changed.data.titles).not.toContainEqual(
		expect.objectContaining({ value: "中文标题" }),
	);
});

test("changed peer source evidence invalidates persisted names without an extra current-read request", async () => {
	const f = await fixture();
	const reference = f.metadata.resolveReference("one:anime:1"),
		peer = f.metadata.resolveReference("two:anime:1");
	await f.metadata.get(reference);
	await f.restart();
	const data = f.data[1];
	if (!data) throw new Error("Missing peer fixture");
	data.startDate = { year: 2027, month: 2, day: 1 };
	await f.metadata.get(peer, { refresh: true });
	const calls = f.get.mock.calls.length;
	expect(f.metadata.current(reference)?.data.displayTitle).toBe("Original");
	expect(f.get).toHaveBeenCalledTimes(calls);
	const titles = f.database.metadata
		.titles([{ provider: "one", mediaType: "anime", id: "1" }])
		.get("one:anime:1");
	expect(titles).not.toContainEqual(
		expect.objectContaining({ value: "中文标题" }),
	);
});

test.each([undefined, "older-policy"])(
	"persisted names require the current verification policy: %s",
	async (version) => {
		const f = await fixture();
		const reference = f.metadata.resolveReference("one:anime:1");
		const before = await f.metadata.get(reference);
		const entry = f.database.metadata.get(before.snapshotId);
		if (!entry) throw new Error("Missing project fixture");
		const document = structuredClone(entry.data) as ProjectDocument;
		if (!document.nameEvidence) throw new Error("Missing name evidence");
		if (version === undefined) delete document.nameEvidence.verificationVersion;
		else document.nameEvidence.verificationVersion = version;
		f.database.metadata.save({ ...entry, data: document });
		await f.restart();
		const calls = f.search.mock.calls.length;
		expect(
			f.database.metadata
				.titles([{ provider: "one", mediaType: "anime", id: "1" }])
				.get("one:anime:1"),
		).not.toContainEqual(expect.objectContaining({ value: "中文标题" }));
		expect(
			(await f.metadata.get(reference, { cachedOnly: true })).data.displayTitle,
		).toBe("Original");
		expect(f.search).toHaveBeenCalledTimes(calls);
		expect((await f.metadata.get(reference)).data.displayTitle).toBe(
			"中文标题",
		);
		const restored = await f.metadata.get(reference, { cachedOnly: true });
		const restoredDocument = f.database.metadata.get(restored.snapshotId)
			?.data as ProjectDocument;
		expect(restoredDocument.nameEvidence?.verificationVersion).toBe(
			metadataDefaults.nameVerificationVersion,
		);
	},
);
