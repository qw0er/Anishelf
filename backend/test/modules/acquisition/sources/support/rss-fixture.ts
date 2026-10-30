import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { rssConstraints } from "../../../../../src/contracts/defaults.js";
import { createAcquisitionModule } from "../../../../../src/modules/acquisition/create.js";
import type { FeedTransport } from "../../../../../src/modules/acquisition/sources/rss/ports.js";
import { AnitomyIdentificationParser } from "../../../../../src/modules/anime/identification/infrastructure/parser.js";
import type { AcquisitionTarget } from "../../../../../src/modules/anime/public.js";
import { AnimeReleaseAssessment } from "../../../../../src/modules/anime/release-assessment/application.js";
import { fixtureAssociations } from "../../../../support/metadata-associations.js";

export const cleanup: (() => Promise<unknown>)[] = [];

export const key = "anilist:anime:1";

function missingDiscovery(): never {
	throw new Error("Missing discovery.");
}

export const hash = "a".repeat(40),
	secondHash = "b".repeat(40);

export function item(
	title = "[Group] Frieren - 03 [1080p]",
	id = hash,
	date = "Tue, 20 Oct 2026 10:00:00 GMT",
) {
	return `<item><title>${title}</title><guid>${id}</guid><pubDate>${date}</pubDate><enclosure url="magnet:?xt=urn:btih:${id}" type="application/x-bittorrent" length="100"/></item>`;
}

export function feed(items = item()) {
	return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
}

export const target: AcquisitionTarget = {
	work: {
		reference: { id: "1" },
		snapshotId: "snapshot",
		titles: ["Frieren"],
		titleVariants: [{ value: "Frieren", kind: "primary", language: "en" }],
		year: 2023,
		format: "TV",
		episodeCount: 28,
		season: null,
		part: null,
	},
	availableEpisodes: [],
	revision: "catalog-1",
};

export const assessor = new AnimeReleaseAssessment(
	new AnitomyIdentificationParser(),
	{} as never,
	undefined,
	fixtureAssociations(),
);

export async function fixture(
	createClient?: Parameters<typeof createAcquisitionModule>[0]["createClient"],
) {
	const dataDir = await mkdtemp(join(tmpdir(), "anishelf-rss-"));
	cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
	const database = ApplicationDatabase.openMemory();
	cleanup.push(async () => database.close());
	let clock = 1_000_000;
	const state = {
		target: structuredClone(target),
		refreshIntervalMinutes: undefined as number | undefined,
		profileId: undefined as string | undefined,
	};
	const fetch = vi.fn<FeedTransport["fetch"]>(async () => ({
		xml: feed(),
		etag: "etag-1",
		lastModified: null as string | null,
	}));
	const logs: string[] = [];
	const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
	const options = {
		dataDir,
		logger,
		store: database.acquisition,
		downloadStore: database.acquisitionDownloads,
		anime: {
			target: vi.fn(async () => state.target),
			assessReleaseTitle: (title: string, target: AcquisitionTarget) =>
				assessor.assessReleaseTitle(title, target),
		},
		transport: { fetch, close: async () => {} },
		now: () => clock,
		rssRefreshIntervalMinutes: () => state.refreshIntervalMinutes,
		defaultAcquisitionProfileId: () => state.profileId,
		autoStart: false,
		...(createClient ? { createClient } : {}),
	};
	const module = await createAcquisitionModule(options);
	cleanup.push(() => module.close());
	const discovery = module.api.subscriptions ?? missingDiscovery();
	function stamp() {
		const value = {
			revision: "destination",
			connectionGeneration: module.api.connection.settings().generation,
			scopeId: "root",
			path: "/downloads",
			validated: true,
			visibilityVerified: false,
		};
		database.acquisitionDownloads.saveDestination(value);
		return {
			destinationRevision: value.revision,
			connectionGeneration: value.connectionGeneration,
		};
	}
	async function subscribe(
		workKey = key,
		startEpisode = 1,
		rss = "https://feeds.example.org/rss?passkey=private-feed-token",
	) {
		const saved = await discovery.save({
			workKey,
			source: { kind: "feed" as const, url: rss },
			startEpisode,
			revision: discovery.get(workKey).subscription?.revision ?? null,
			...stamp(),
		});
		// A save is local; explicitly run the background stage in this fixture.
		const sourceId = saved.subscription?.feedId ?? "";
		const record = database.acquisition.feed(sourceId);
		if (record) database.acquisition.saveFeed({ ...record, checkedAt: null });
		return discovery.refresh(workKey, saved.subscription?.revision ?? "");
	}
	return {
		dataDir,
		database,
		module,
		discovery,
		stamp,
		fetch,
		state,
		logs,
		options,
		subscribe,
		advance: (
			milliseconds = rssConstraints.defaultRefreshIntervalMinutes * 60_000,
		) => {
			clock += milliseconds;
		},
	};
}

export function setupTestLifecycle() {
	afterEach(async () => {
		vi.useRealTimers();
		for (const close of cleanup.splice(0).reverse()) await close();
	});
}
