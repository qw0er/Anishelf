import pino from "pino";
import { expect, test, vi } from "vitest";
import { DiscoveryApplication } from "../src/modules/acquisition/discovery/application/application.js";
import type {
	Candidate,
	Subscription,
} from "../src/modules/acquisition/discovery/public.js";
import type {
	SourceSnapshot,
	SourcesApi,
} from "../src/modules/acquisition/sources/public.js";
import type { AcquisitionTarget } from "../src/modules/anime/public.js";

test("Discovery previews, confirms and refreshes an opaque source without protocol configuration", async () => {
	// A query adapter can supply this boundary without an RSS URL or discriminator.
	const reference = Object.freeze({ id: "indexer-query-plan" });
	const makeSnapshot = (revision: string, episode: number): SourceSnapshot => ({
		id: reference.id,
		revision,
		label: "Configured indexer",
		checkedAt: 0,
		nextAttemptAt: 0,
		error: null,
		entries: [
			{
				id: `release-${episode}`,
				observationId: `observation-${episode}`,
				title: `Frieren - ${episode}`,
				publishedAt: null,
				download: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
				hash: "a".repeat(40),
			},
		],
	});
	let remote = makeSnapshot("first", 3);
	let saved: SourceSnapshot | null = null;
	const refresh = vi.fn(async (input) => {
		expect(input).toBe(reference);
		return remote;
	});
	const sources: SourcesApi = {
		readDownload: vi.fn(),
		isDownloadCurrent: vi.fn(() => true),
		register: vi.fn(),
		setEnabled: vi.fn(),
		remove: vi.fn(),
		reference: (id) => {
			expect(id).toBe(reference.id);
			return reference;
		},
		snapshot: () => saved,
		refresh,
		isCurrent: () => true,
		publish: (result) => {
			saved = result;
		},
		failed: vi.fn(),
		start: vi.fn(),
		close: vi.fn(async () => {}),
	};
	const subscriptions = new Map<string, Subscription>();
	const candidates = new Map<string, Candidate[]>();
	const target: AcquisitionTarget = {
		work: {
			reference: { provider: "anilist", mediaType: "anime", id: "1" },
			snapshotId: "metadata",
			titles: ["Frieren"],
			titleVariants: [],
			year: 2023,
			format: "TV",
			episodeCount: 28,
			season: null,
			part: null,
		},
		availableEpisodes: [],
		revision: "target",
	};
	const discovery = new DiscoveryApplication({
		sources,
		store: {
			transaction: (operation) => operation(),
			subscription: (key) => subscriptions.get(key) ?? null,
			subscriptions: () => [...subscriptions.values()],
			candidates: (key) => candidates.get(key) ?? [],
			saveSubscription: (subscription, result) => {
				subscriptions.set(subscription.workKey, subscription);
				candidates.set(subscription.workKey, result);
			},
			updateCandidates: (subscription, result) => {
				candidates.set(subscription.workKey, result);
				return true;
			},
			reservationOutcome: vi.fn(),
			remove: () => false,
		},
		anime: {
			target: async () => target,
			assessReleaseTitle: (title) => ({
				episode: Number(title.split(" - ")[1]),
				eligible: true,
				reasons: [],
				version: "test",
			}),
		},
		downloads: async () => [],
		confirmation: {
			commit: (_subscription, _destination, persist) => persist(),
		},
		logger: pino({ level: "silent" }),
		now: () => 1_000_000,
	});
	try {
		const key = "anilist:anime:1";
		const preview = await discovery.preview("session", {
			workKey: key,
			source: reference,
			startEpisode: 1,
			revision: null,
		});
		expect(preview.source).toBe("Configured indexer");
		expect(preview.candidates[0]?.episode).toBe(3);
		expect(subscriptions.size).toBe(0);
		expect(saved).toBeNull();
		const confirmed = await discovery.confirm("session", key, preview.token);
		expect(confirmed.subscription?.feedId).toBe(reference.id);
		expect(saved).toEqual(remote);
		remote = makeSnapshot("next", 4);
		const updated = await discovery.refresh(
			key,
			confirmed.subscription?.revision ?? "",
		);
		expect(updated.candidates[0]?.episode).toBe(4);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(saved).toEqual(remote);
		expect(sources.failed).not.toHaveBeenCalled();
	} finally {
		await discovery.close();
	}
});
