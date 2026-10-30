import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { DownloadsApplication } from "../../../../src/modules/acquisition/downloads/application/application.js";
import { createSourcesModule } from "../../../../src/modules/acquisition/sources/create.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { SubscriptionsApplication } from "../../../../src/modules/acquisition/subscriptions/application/application.js";
import { WatchingApplication } from "../../../../src/modules/acquisition/watching/application/application.js";
import type { WatchingSnapshot } from "../../../../src/modules/acquisition/watching/public.js";

import {
	cleanup,
	connectedModule,
	fixture,
	hash,
	key,
	logger,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("direct save flows through background selection, one download and verified ingestion", async () => {
	const f = await fixture();
	f.db.acquisition.remove(
		key,
		f.db.acquisition.subscription(key)?.revision ?? "",
	);
	await writeFile(
		join(f.dir, "acquisition-profiles.yaml"),
		"version: 1\nprofiles:\n  - id: custom:any\n    name: Any\n    levels:\n      - name: Any\n        match: {}\n        acceptAfterMinutes: 0\n",
	);
	vi.useFakeTimers();
	let module: Awaited<ReturnType<typeof connectedModule>> | undefined;
	try {
		module = await connectedModule(f, true);
		const downloads = module.api.downloads;
		if (!downloads) throw new Error();
		const destination = await downloads.saveDestination({
			revision: null,
			scopeId: "root",
			path: "/downloads",
		});
		await downloads.validate(destination.revision);
		const calls = f.anime.target.mock.calls.length;
		const saved = await module.api.subscriptions.save({
			workKey: key,
			source: { kind: "feed" as const, url: "https://example.org/automatic" },
			startEpisode: 1,
			profileId: "custom:any",
			revision: null,
			destinationRevision: destination.revision,
			connectionGeneration: module.api.connection.settings().generation,
		});
		expect(saved.candidates).toEqual([]);
		expect(f.anime.target).toHaveBeenCalledTimes(calls);
		expect(f.add).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(downloads.activity(key).items[0]?.state).toBe("bound");
		f.complete();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
		expect(downloads.activity(key).items[0]).toMatchObject({
			state: "available",
			ingestion: "available",
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.add).toHaveBeenCalledTimes(1);
		expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
	} finally {
		await module?.close();
		vi.useRealTimers();
	}
});

test.each([false, true])(
	"search subscriptions use the validated download pipeline; changed connector before submission=%s",
	async (changeConnector) => {
		const f = await fixture();
		const search = vi
			.spyOn(JackettConnection.prototype, "search")
			.mockImplementation(async (plan) => ({
				entries:
					plan.indexerId === "first"
						? []
						: [
								{
									id: "query-release",
									observationId: "query-release",
									title: "Frieren - 03",
									publishedAt: null,
									hash,
									downloadUrl: null,
									download: {
										kind: "jackett-torrent",
										generation: plan.generation,
										indexerId: plan.indexerId,
										path: `/api/v2.0/indexers/${plan.indexerId}/results/torznab/api`,
										file: "private-locator",
									},
								},
							],
				coverage: { limited: false, reason: null, pages: 1, queries: 1 },
				outcome: plan.indexerId === "first" ? "no_match" : "matches",
			}));
		const read = vi
			.spyOn(JackettConnection.prototype, "readTorrent")
			.mockResolvedValue({
				kind: "magnet",
				uri: `magnet:?xt=urn:btih:${hash}`,
			});
		try {
			const sources = await createSourcesModule({
				dataDir: f.dir,
				store: f.db.acquisition,
				logger,
			});
			cleanup.push(() => sources.runtime.close());
			await sources.api.connector.save({
				generation: sources.api.connector.settings().generation,
				url: "http://jackett:9117",
				apiKey: "private-key",
				origin: "external",
				providers: ["first", "second"],
			});
			const subscriptions = new SubscriptionsApplication({
				store: f.db.acquisition,
				sources: sources.api,
				anime: f.anime,
				downloads: async () => [],
				logger,
				profiles: [
					{
						id: "custom:instant",
						name: "Instant",
						levels: [{ name: "Any", match: {}, acceptAfterMinutes: 0 }],
					},
				],
				defaultProfileId: () => "custom:instant",
				downloadTarget: () => f.db.acquisitionDownloads.destination(),
				lockedCandidates: (workKey) =>
					f.db.acquisitionDownloads.lockedCandidates(workKey),
			});
			cleanup.push(() => subscriptions.close());
			const worker = new DownloadsApplication({
				store: f.db.acquisitionDownloads,
				selection: subscriptions.selection(),
				resources: f.resources,
				anime: f.anime,
				ingestion: f.ingestion,
				transport: {
					read: (reference, signal) =>
						sources.api.readContent(reference, signal),
					isCurrent: (reference) => sources.api.isContentCurrent(reference),
					close: async () => {},
				},
				connectionGeneration: () => "account-1",
				withClient: async (_generation, operation) => operation(f.client),
				logger,
			});
			cleanup.push(() => worker.close());
			const dest = await worker.saveDestination({
				revision: null,
				scopeId: "root",
				path: "/downloads",
			});
			await worker.validate(dest.revision);
			const revision = f.db.acquisition.subscription(key)?.revision ?? null;
			const result = await subscriptions.search({
				workKey: key,
				revision,
				startEpisode: 1,
			});
			expect(result.source?.providerId).toBe("second");
			expect(f.db.acquisition.authorization(key)).toBeNull();
			expect(f.add).not.toHaveBeenCalled();
			const saved = await subscriptions.save({
				workKey: key,
				revision,
				startEpisode: 1,
				source: result.source,
				target: {
					destinationRevision: dest.revision,
					connectionGeneration: "account-1",
				},
			});
			await subscriptions.refresh(key, saved.subscription?.revision ?? "");
			expect(worker.activity(key).authorized).toBe(true);
			expect(subscriptions.get(key).candidates[0]?.status).toBe("selected");
			if (changeConnector)
				await sources.api.connector.clear(
					sources.api.connector.settings().generation,
				);
			await worker.tick();
			if (changeConnector) {
				expect(subscriptions.get(key).subscription?.error).toBe(
					"source_changed",
				);
				expect(f.add).not.toHaveBeenCalled();
				expect(read).not.toHaveBeenCalled();
			} else {
				expect(read).toHaveBeenCalledTimes(1);
				expect(f.add).toHaveBeenCalledTimes(1);
				expect(f.add.mock.calls[0]?.[0].source).toEqual({
					magnet: `magnet:?xt=urn:btih:${hash}`,
				});
				await worker.tick();
				expect(f.add).toHaveBeenCalledTimes(1);
				f.complete();
				await worker.tick();
				expect(f.ingestion.ingest).toHaveBeenCalled();
			}
		} finally {
			search.mockRestore();
			read.mockRestore();
		}
	},
);

test.each([
	{ change: "disable", submitted: false },
	{ change: "paused", submitted: false },
	{ change: "disable", submitted: true },
	{ change: "paused", submitted: true },
])(
	"Watching gates new submissions and preserves submitted downloads after $change; submitted=$submitted",
	async ({ change, submitted }) => {
		const f = await fixture();
		const old = f.db.acquisition.subscription(key);
		if (!old) throw Error("Missing initial subscription");
		f.db.acquisition.remove(key, old.revision);
		const search = vi
			.spyOn(JackettConnection.prototype, "search")
			.mockResolvedValue({
				entries: [
					{
						id: "managed",
						observationId: "managed",
						title: "Frieren - 03",
						publishedAt: null,
						hash,
						downloadUrl: null,
						download: { kind: "magnet", uri: `magnet:?xt=urn:btih:${hash}` },
					},
				],
				outcome: "matches",
				coverage: { limited: false, reason: null, pages: 1, queries: 1 },
			});
		cleanup.push(async () => search.mockRestore());
		const sources = await createSourcesModule({
			dataDir: f.dir,
			store: f.db.acquisition,
			logger,
		});
		cleanup.push(() => sources.runtime.close());
		await sources.api.connector.save({
			generation: sources.api.connector.settings().generation,
			url: "http://jackett:9117",
			apiKey: "private-key",
			origin: "external",
			providers: ["nyaasi"],
		});
		const snapshot: WatchingSnapshot = {
			accountId: "tracking-account",
			generation: "tracking-generation",
			revision: "list",
			fresh: true,
			complete: true,
			refreshAllowed: true,
			retryAt: null,
			entries: [
				{ workKey: key, title: "Frieren", status: "watching", progress: 2 },
			],
		};
		let watching: WatchingApplication;
		const subscriptions = new SubscriptionsApplication({
			store: f.db.acquisition,
			sources: sources.api,
			anime: f.anime,
			downloads: async () => [],
			logger,
			profiles: [
				{
					id: "custom:instant",
					name: "Instant",
					levels: [{ name: "Any", match: {}, acceptAfterMinutes: 0 }],
				},
			],
			defaultProfileId: () => "custom:instant",
			downloadTarget: () => f.db.acquisitionDownloads.destination(),
			lockedCandidates: (workKey) =>
				f.db.acquisitionDownloads.lockedCandidates(workKey),
			onRemoved: (key) => watching?.manualRemove(key),
			managedStopReason: (subscription) =>
				watching ? watching.stopReason(subscription) : "authorization_required",
		});
		cleanup.push(() => subscriptions.close());
		const suspend = () => {
			if (change === "disable") watching.disable(watching.status().revision);
			else {
				snapshot.entries = snapshot.entries.map((entry) => ({
					...entry,
					status: "paused",
				}));
				snapshot.revision = "paused-list";
			}
		};
		let reservedBeforeSuspend = false;
		const worker = new DownloadsApplication({
			store: f.db.acquisitionDownloads,
			selection: subscriptions.selection(),
			resources: f.resources,
			anime: f.anime,
			ingestion: f.ingestion,
			transport: {
				read: async (reference, signal) => {
					if (!submitted) {
						reservedBeforeSuspend =
							f.db.acquisitionDownloads.activity(key, 1, 100).items.length > 0;
						suspend();
					}
					return sources.api.readContent(reference, signal);
				},
				isCurrent: (reference) => sources.api.isContentCurrent(reference),
				close: async () => {},
			},
			connectionGeneration: () => "account-1",
			withClient: async (_generation, operation) => operation(f.client),
			logger,
		});
		cleanup.push(() => worker.close());
		watching = new WatchingApplication({
			store: f.db.acquisition.watching,
			transaction: (operation) => f.db.acquisition.transaction(operation),
			tracking: {
				snapshot: () => structuredClone(snapshot),
				refresh: async () => structuredClone(snapshot),
			},
			sources: sources.api,
			subscriptions,
			subscription: (key) => f.db.acquisition.subscription(key),
			admit: (input, commit) => {
				subscriptions.saveAtomically(input, commit);
			},
			target: () => f.db.acquisitionDownloads.destination(),
			profileFingerprint: () => "instant-v1",
			logger,
		});
		cleanup.push(() => watching.close());
		const destination = await worker.saveDestination({
			revision: null,
			scopeId: "root",
			path: "/downloads",
		});
		await worker.validate(destination.revision);
		const preview = await watching.preview("session", "unconfigured", {
			backlog: "progress",
			profileId: "custom:instant",
		});
		watching.confirm("session", preview.id);
		await watching.tick();
		const subscription = f.db.acquisition.subscription(key);
		if (!subscription) throw Error("Managed admission failed");
		await subscriptions.refresh(key, subscription.revision);
		await worker.tick();
		if (!submitted) {
			expect(reservedBeforeSuspend).toBe(true);
			expect(f.add).not.toHaveBeenCalled();
			expect(f.ingestion.ingest).not.toHaveBeenCalled();
		} else {
			expect(f.add).toHaveBeenCalledTimes(1);
			suspend();
			f.complete();
			await worker.tick();
			expect(f.ingestion.ingest).toHaveBeenCalledTimes(1);
			expect(worker.activity(key).items[0]).toMatchObject({
				state: "available",
				ingestion: "available",
			});
			await worker.tick();
			expect(f.add).toHaveBeenCalledTimes(1);
		}
		expect(subscriptions.selection().subscription(key)?.enabled).toBe(false);
	},
);
