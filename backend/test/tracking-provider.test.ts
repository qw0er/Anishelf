import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import type { ReviewItem } from "../src/modules/anime/anime-catalog/public.js";
import { AnimeLibraryQueries } from "../src/modules/anime/anime-library/application/library.js";
import { TrackingViewingCommands } from "../src/modules/anime/tracking/application/viewing.js";
import { createTrackingModule } from "../src/modules/anime/tracking/create.js";
import type { TrackingProviderDescriptor } from "../src/modules/anime/tracking/domain/model.js";
import type { TrackingDesiredState } from "../src/modules/anime/tracking/domain/operation.js";
import { registerTrackingListRoutes } from "../src/modules/anime/tracking/http/lists.js";
import { registerTrackingUpdateRoutes } from "../src/modules/anime/tracking/http/updates.js";
import type { TrackingUpdateProvider } from "../src/modules/anime/tracking/ports.js";
import {
	externalId,
	externalIdParts,
	workKey,
	workReference,
} from "../src/shared/external-reference.js";
import { fixtureAssociations } from "./support/metadata-associations.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const descriptor: TrackingProviderDescriptor = {
	key: "fixture",
	name: "Fixture Tracker",
	authorization: {
		kind: "credential",
		label: "Personal credential",
		url: null,
	},
	capabilities: {
		progress: "cumulative-episodes",
		maximumProgress: 1000,
		statuses: ["watching", "planned", "completed"],
	},
};
const reference = {
	provider: "fixture",
	mediaType: "anime" as const,
	id: "show/alpha:β",
};
const accountId = externalId("fixture", "user/alpha");
const mediaId = workKey(reference);

async function fixture(persistent = false) {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-provider-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	let database = persistent
		? ApplicationDatabase.open(directory)
		: ApplicationDatabase.openMemory();
	cleanup.push(() => database.close());
	// Deliberately different wire codes, opaque IDs, no remote modification timestamp.
	let remote = {
		id: "entry/alpha",
		episodes: 3,
		state: "IN_PROGRESS" as "IN_PROGRESS" | "QUEUED" | "DONE",
	};
	const decode = () => ({
		id: externalId("fixture", remote.id),
		progress: remote.episodes,
		status:
			remote.state === "DONE"
				? ("completed" as const)
				: remote.state === "QUEUED"
					? ("planned" as const)
					: ("watching" as const),
		updatedAt: null,
	});
	const get = vi.fn<TrackingUpdateProvider["get"]>(async (lease) => {
		expect(lease.accountId).toBe(accountId);
		expect(lease.credential).toBe("opaque credential with spaces");
		return decode();
	});
	const save = vi.fn<TrackingUpdateProvider["save"]>(
		async (_lease, key, _entry, desired) => {
			expect(key).toBe(mediaId);
			remote = {
				...remote,
				episodes: desired.progress ?? remote.episodes,
				state:
					desired.status === "completed"
						? "DONE"
						: desired.status === "planned"
							? "QUEUED"
							: desired.status === "watching"
								? "IN_PROGRESS"
								: remote.state,
			};
			return decode();
		},
	);
	const construct = (provider = descriptor) =>
		createTrackingModule({
			dataDir: directory,
			store: database.tracking,
			listStore: database.trackingLists,
			operationStore: database.trackingOperations,
			descriptor: provider,
			accountProvider: {
				viewer: async () => ({
					id: externalId(provider.key, "user/alpha"),
					name: "Fixture",
				}),
			},
			listProvider: {
				read: async () => [
					{
						...decode(),
						mediaId,
						titles: ["Fixture work"],
						format: "TV",
						year: 2026,
						episodeCount: 12,
						coverUrl: null,
					},
				],
			},
			updateProvider: { get, save },
		});
	let module = await construct();
	cleanup.push(() => module.close());
	const preview = await module.preview(
		"session",
		"opaque credential with spaces",
	);
	await module.confirm("session", preview.candidateId, preview.generation);
	await module.refreshList();
	return {
		get module() {
			return module;
		},
		get database() {
			return database;
		},
		get,
		save,
		async restart(provider = descriptor) {
			if (!persistent)
				throw new Error("Restart requires a persistent fixture.");
			await module.close();
			database.close();
			database = ApplicationDatabase.open(directory);
			module = await construct(provider);
		},
		setRemote(progress: number) {
			remote.episodes = progress;
		},
	};
}

test("opaque identities survive HTTP commands, null timestamps, restart and Library projections", async () => {
	const f = await fixture(true);
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		registrations: [
			(app) => {
				registerTrackingListRoutes(app, f.module);
				registerTrackingUpdateRoutes(app, f.module);
			},
		],
		closeDependencies: async () => {},
	});
	cleanup.push(() => http.close());
	const snapshot = f.module.list();
	const entry = snapshot.entries[0];
	expect(entry?.updatedAt).toBeNull();
	const generation = snapshot.generation;
	const response = await http.inject({
		method: "POST",
		url: `/api/tracking/entries/${encodeURIComponent(mediaId)}/updates`,
		headers: { host: "127.0.0.1:3000" },
		payload: {
			commandId: randomUUID(),
			generation,
			revision: null,
			baseline: entry
				? {
						id: entry.id,
						progress: entry.progress,
						status: entry.status,
						updatedAt: entry.updatedAt,
					}
				: null,
			desired: { progress: 4, status: "completed" },
		},
	});
	expect(response.statusCode, response.body).toBe(200);
	await vi.waitFor(() =>
		expect(f.module.operations(generation)[0]?.state).toBe("succeeded"),
	);
	expect(f.save).toHaveBeenCalledTimes(1);
	await f.restart();
	expect(f.module.status().account?.id).toBe(accountId);
	expect(f.module.operations(generation)[0]?.remote).toMatchObject({
		progress: 4,
		status: "completed",
		updatedAt: null,
	});
	await f.module.refreshList();
	const library = new AnimeLibraryQueries({
		catalog: undefined,
		lists: f.module,
		logger: pino({ enabled: false }),
	});
	const cards = (await library.list({ scope: "all" })).items;
	expect(cards[0]).toMatchObject({
		id: mediaId,
		reference,
		localWorkId: null,
		viewingAvailability: "tracked",
		viewing: { progress: 4, status: "completed" },
	});
});

test("capabilities and namespaces reject unsupported writes before any provider dispatch", async () => {
	const f = await fixture();
	const snapshot = f.module.list();
	const command = (desired: TrackingDesiredState) => ({
		generation: snapshot.generation,
		revision: null,
		baseline: null,
		desired,
	});
	expect(() =>
		f.module.update(mediaId, command({ status: "paused" })),
	).toThrow();
	expect(() => f.module.update(mediaId, command({ progress: 1001 }))).toThrow();
	expect(() =>
		f.module.update(
			workKey({ ...reference, provider: "other" }),
			command({ status: "watching" }),
		),
	).toThrow();
	expect(f.module.operations(snapshot.generation)).toEqual([]);
	expect(f.save).not.toHaveBeenCalled();
});

test("provider changes fence saved accounts and isolate colliding account and work IDs", async () => {
	const f = await fixture(true);
	const previousGeneration = f.module.status().generation;
	f.get.mockRejectedValueOnce(new Error("offline"));
	const operation = f.module.update(mediaId, {
		commandId: randomUUID(),
		generation: previousGeneration,
		revision: null,
		baseline: null,
		desired: { status: "watching", progress: 4 },
	});
	await vi.waitFor(() =>
		expect(f.module.operations(previousGeneration)[0]?.state).toBe("failed"),
	);
	await f.restart({ ...descriptor, key: "other" });
	expect(f.module.status()).toMatchObject({
		state: "disconnected",
		account: null,
		provider: { key: "other" },
	});
	expect(f.module.status().generation).not.toBe(previousGeneration);
	expect(f.module.list().entries).toEqual([]);
	expect(f.database.trackingOperations.list(accountId)[0]?.id).toBe(
		operation.id,
	);
	expect(
		f.database.trackingOperations.list(externalId("other", "user/alpha")),
	).toEqual([]);
	expect(f.save).not.toHaveBeenCalled();
});

test("episode resolution reports unmapped, ambiguous and unsupported independently of Provider spelling", async () => {
	const f = await fixture();
	const review = {
		id: "review",
		available: true,
		decision: "confirmed",
		sourceVersion: "v1",
		revision: 1,
		associations: [
			{
				reference: { id: reference.id },
				kind: "regular",
				number: "4",
				episodeId: "episode",
			},
		],
	} as ReviewItem;
	const viewing = new TrackingViewingCommands(
		{ fileReviews: async () => [review] },
		f.module,
		undefined,
		undefined,
		{
			...fixtureAssociations("fixture"),
			externalReference: (ref) =>
				ref.id === "unmapped" ? null : { ...reference, id: ref.id },
		},
	);
	expect(await viewing.resolveTarget("file", "v1")).toMatchObject({
		state: "resolved",
		target: { mediaId, episode: 4 },
	});
	const context = await viewing.capture("file", "v1");
	if (!context) throw new Error("Missing observation context.");
	f.module.update(mediaId, {
		generation: f.module.status().generation,
		revision: null,
		baseline: f.module.list().entries[0] ?? null,
		desired: { progress: 2 },
	});
	expect(await viewing.submit(context, randomUUID())).toMatchObject({
		state: "ignored",
		reason: "manual-change",
	});
	const association = review.associations[0];
	if (!association?.reference) throw new Error("Missing association.");
	association.reference = { id: "unmapped" };
	expect(await viewing.resolveTarget("file", "v1")).toEqual({
		state: "unmapped",
		target: null,
	});
	review.associations.push({ ...association });
	expect(await viewing.resolveTarget("file", "v1")).toEqual({
		state: "ambiguous",
		target: null,
	});
	review.associations.pop();
	association.reference = reference;
	association.number = "4.5";
	expect(await viewing.resolveTarget("file", "v1")).toEqual({
		state: "unsupported",
		target: null,
	});
});

test("canonical references round-trip delimiter and unicode IDs without collisions", () => {
	expect(workReference(mediaId)).toEqual(reference);
	expect(externalIdParts(accountId)).toEqual({
		provider: "fixture",
		id: "user/alpha",
	});
	expect(workKey({ ...reference, provider: "other" })).not.toBe(mediaId);
	expect(() => workReference("fixture:anime:show%2falpha")).toThrow();
});
