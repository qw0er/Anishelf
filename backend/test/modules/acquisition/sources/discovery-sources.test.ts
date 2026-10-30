import pino from "pino";
import { expect, test, vi } from "vitest";
import type {
	SourceSnapshot,
	SourcesApi,
} from "../../../../src/modules/acquisition/sources/public.js";
import { SubscriptionsApplication } from "../../../../src/modules/acquisition/subscriptions/application/application.js";
import type {
	Candidate,
	Subscription,
} from "../../../../src/modules/acquisition/subscriptions/public.js";
import type { AcquisitionTarget } from "../../../../src/modules/anime/public.js";

test("Subscriptions save and refresh an opaque source without protocol configuration", async () => {
	// A query adapter can supply this boundary without an RSS URL or discriminator.
	const reference = Object.freeze({ id: "indexer-query-plan" });
	const makeSnapshot = (revision: string, episode: number): SourceSnapshot => ({
		id: reference.id,
		revision,
		label: "Configured indexer",
		checkedAt: null,
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
		snapshot: () => saved ?? { ...remote, entries: [], checkedAt: null },
		readContent: vi.fn(),
		isContentCurrent: vi.fn(),
		test: vi.fn(),
		connector: {
			useBundled: vi.fn(),
			settings: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			providers: vi.fn(),
			probe: vi.fn(),
		},
		fetch: async (input) => {
			expect(input).toMatchObject({ kind: "search" });
			const result = await refresh(reference);
			return {
				snapshot: result,
				commit: (operation) => {
					saved = result;
					operation();
				},
			};
		},
	};
	const subscriptions = new Map<string, Subscription>();
	const candidates = new Map<string, Candidate[]>();
	const target: AcquisitionTarget = {
		work: {
			reference: { id: "1" },
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
	const discovery = new SubscriptionsApplication({
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
			authorization: () => null,
			authorize: vi.fn(),
			revoke: vi.fn(),
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
		logger: pino({ level: "silent" }),
		now: () => 1_000_000,
	});
	try {
		const key = "anilist:anime:1";
		const created = await discovery.save({
			workKey: key,
			source: {
				kind: "search",
				connectionRevision: "connection",
				providerId: "example",
				titles: ["Frieren"],
			},
			startEpisode: 1,
			revision: null,
			target: null,
		});
		expect(created.subscription?.feedId).toBe(reference.id);
		expect(refresh).not.toHaveBeenCalled();
		const confirmed = await discovery.refresh(
			key,
			created.subscription?.revision ?? "",
		);
		expect(confirmed.candidates[0]?.episode).toBe(3);
		expect(saved).toEqual(remote);
		remote = makeSnapshot("next", 4);
		const updated = await discovery.refresh(
			key,
			confirmed.subscription?.revision ?? "",
		);
		expect(updated.candidates[0]?.episode).toBe(4);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(saved).toEqual(remote);
	} finally {
		await discovery.close();
	}
});
