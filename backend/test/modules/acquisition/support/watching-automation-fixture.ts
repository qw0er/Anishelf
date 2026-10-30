import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { createSourcesModule } from "../../../../src/modules/acquisition/sources/create.js";
import { JackettConnection } from "../../../../src/modules/acquisition/sources/jackett/connection.js";
import { SubscriptionsApplication } from "../../../../src/modules/acquisition/subscriptions/application/application.js";
import { WatchingApplication } from "../../../../src/modules/acquisition/watching/application/application.js";
import type { WatchingSnapshot } from "../../../../src/modules/acquisition/watching/public.js";
import type { AcquisitionTarget } from "../../../../src/modules/anime/public.js";

export const cleanup: (() => unknown)[] = [];

export function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}

export const workKey = "anilist:anime:1";

export const config = {
	backlog: "progress" as const,
	profileId: "custom:instant",
};

export async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-watching-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	let clock = 1000000;
	const snapshot: WatchingSnapshot = {
		accountId: "tracking-account",
		generation: "tracking-generation",
		revision: "snapshot-one",
		complete: true,
		fresh: true,
		refreshAllowed: true,
		retryAt: null,
		entries: [{ workKey, title: "Frieren", status: "watching", progress: 2 }],
	};
	const logger = pino({ level: "silent" });
	const search = vi
		.spyOn(JackettConnection.prototype, "search")
		.mockImplementation(async () => ({
			entries: [
				{
					id: "entry",
					observationId: "entry",
					title: "Frieren - 03",
					publishedAt: null,
					downloadUrl: null,
					hash: "a".repeat(40),
					download: {
						kind: "magnet",
						uri: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
					},
				},
			],
			outcome: "matches",
			coverage: { limited: false, reason: null, pages: 1, queries: 1 },
		}));
	const target: AcquisitionTarget = {
		work: {
			reference: { id: "1" },
			snapshotId: "metadata",
			titles: ["Frieren"],
			year: 2023,
			format: "TV",
			episodeCount: 28,
			season: null,
			part: null,
		},
		availableEpisodes: [],
		revision: "target",
	};
	let fingerprint = "profile-one";
	let defaultProfileId = config.profileId;
	const destination = {
		revision: "destination",
		connectionGeneration: "downloader",
		validated: true,
		path: "/downloads",
	};
	const refresh = vi.fn(async () => structuredClone(snapshot));
	const downloads = vi.fn(async (): Promise<string[]> => []);
	async function open() {
		const db = ApplicationDatabase.open(directory);
		cleanup.push(() => db.close());
		const sources = await createSourcesModule({
			dataDir: directory,
			store: db.acquisition,
			logger,
			now: () => clock,
		});
		cleanup.push(() => sources.runtime.close());
		if (!sources.api.connector.settings().ready)
			await sources.api.connector.save({
				generation: sources.api.connector.settings().generation,
				url: "http://jackett:9117",
				apiKey: "private-key",
				origin: "external",
				providers: ["nyaasi"],
			});
		let watching: WatchingApplication;
		const subscriptions = new SubscriptionsApplication({
			now: () => clock,
			store: db.acquisition,
			sources: sources.api,
			anime: {
				target: async () => target,
				assessReleaseTitle: () => ({
					episode: 3,
					eligible: true,
					reasons: [],
					version: "v1",
				}),
			},
			downloads,
			logger,
			profiles: [
				{
					id: config.profileId,
					name: "Instant",
					levels: [{ name: "Any", match: {}, acceptAfterMinutes: 0 }],
				},
			],
			defaultProfileId: () => defaultProfileId,
			downloadTarget: () => destination,
			onRemoved: (key) => watching?.manualRemove(key),
			managedStopReason: (subscription) =>
				watching ? watching.stopReason(subscription) : "authorization_required",
		});
		cleanup.push(() => subscriptions.close());
		watching = new WatchingApplication({
			store: db.acquisition.watching,
			hasCapacity: () => subscriptions.hasCapacity(),
			renewManaged: (accountId, target, workKeys) =>
				subscriptions.renewManaged(accountId, target, workKeys),
			transaction: (operation) => db.acquisition.transaction(operation),
			tracking: { snapshot: () => structuredClone(snapshot), refresh },
			sources: sources.api,
			subscriptions,
			subscription: (key) => db.acquisition.subscription(key),
			admit: (input, commit) => {
				subscriptions.saveAtomically(input, commit);
			},
			target: () => destination,
			profileFingerprint: () => fingerprint,
			logger,
			now: () => clock,
		});
		cleanup.push(() => watching.close());
		return { db, sources, subscriptions, watching };
	}
	const f = await open();
	const enable = async () => {
		const preview = await f.watching.preview(
			"session",
			f.watching.status().revision,
			config,
		);
		f.watching.confirm("session", preview.id);
		return preview;
	};
	return {
		...f,
		directory,
		logger,
		snapshot,
		search,
		downloads,
		refresh,
		open,
		enable,
		destination,
		target,
		setFingerprint: (value: string) => {
			fingerprint = value;
		},
		setDefaultProfile: (value: string) => {
			defaultProfileId = value;
		},
		advance: () => {
			clock += 3600000;
		},
	};
}

export function setupTestLifecycle() {
	afterEach(async () => {
		for (const close of cleanup.splice(0).reverse()) await close();
		vi.restoreAllMocks();
	});
}
