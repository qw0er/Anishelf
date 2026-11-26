import { expect, test, vi } from "vitest";
import { readHistory } from "../../../src/modules/acquisition/sources/jackett/history.js";
import { SubscriptionDiscovery } from "../../../src/modules/acquisition/subscriptions/application/discovery.js";

import {
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

test.each(["bound", "pending"] as const)(
	"%s subscriptions can find a new episode and an old gap in the same round after a restart",
	async (state) => {
		const f = await fixture((title) => {
			const match = /^Frieren - (\d+)$/.exec(title);
			return {
				episode: match ? Number(match[1]) : null,
				eligible: !!match,
				inspectionCandidate: false,
				reasons: [],
				version: "v1",
			};
		});
		f.target.work.episodeCount = 24;
		f.target.airing = {
			status: "RELEASING",
			nextEpisode: { episode: 24, airingAt: 4_600_000 },
			fetchedAt: 1_000_000,
			stale: false,
			refreshError: false,
		};
		required(f.snapshot.entries[0]).progress = 0;
		const makeEntry = (title: string, id: string) => ({
			id,
			observationId: id,
			title,
			publishedAt: null,
			downloadUrl: null,
			hash: null,
			download: {
				kind: "magnet" as const,
				uri: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
			},
		});
		const calls: number[] = [];
		let nextRound = false;
		f.search.mockImplementation(async ({ titles }, scan) => {
			if (!scan)
				return {
					entries: [makeEntry("Frieren - 24", "new")],
					coverage: { limited: false, reason: null, pages: 1, queries: 1 },
					outcome: "matches",
				};
			return readHistory(
				titles,
				async (_title, offset) => {
					calls.push(offset);
					const title =
						nextRound && offset === 0
							? "Frieren - 24"
							: offset === 4
								? "Frieren - 01"
								: state === "bound" && offset === 0
									? "Frieren - 23"
									: `Unrelated ${offset}`;
					const id = nextRound && offset === 0 ? "new" : String(offset);
					return {
						entries: [makeEntry(title, id)],
						offset,
						total: 12,
						count: 1,
					};
				},
				scan,
			);
		});
		if (state === "pending") {
			await f.enable();
			await f.watching.tick();
		} else {
			await f.subscriptions.save({
				workKey,
				revision: null,
				source: { kind: "automatic" },
				startEpisode: 1,
				target: null,
			});
		}
		await f.subscriptions.resolvePending();
		expect(calls).toEqual([0, 1, 2]);
		const saved = required(f.db.acquisition.sources()[0]);
		expect(saved.snapshot?.jackettHistory?.scan.keywords).toMatchObject([
			{ offset: 3 },
		]);
		expect(saved.snapshot?.nextAttemptAt).toBe(1_300_000);
		expect(f.db.acquisition.subscription(workKey)?.feedId).toBe(
			state === "bound" ? saved.id : null,
		);
		expect(
			f.db.acquisition
				.candidates(workKey)
				.some(({ episode }) => episode === 23),
		).toBe(state === "bound");

		await f.watching.close();
		await f.subscriptions.close();
		await f.sources.runtime.close();
		f.db.close();
		const reopened = await f.open();
		nextRound = true;
		const check = () =>
			state === "bound"
				? reopened.subscriptions.refreshSource(saved.id)
				: reopened.subscriptions.resolvePending();
		f.advanceBy(299_999);
		await check();
		expect(calls).toEqual([0, 1, 2]);
		f.advanceBy(1);
		await check();
		expect(calls).toEqual([0, 1, 2, 0, 3, 4]);
		expect(reopened.db.acquisition.subscription(workKey)?.feedId).toBe(
			saved.id,
		);
		const selected = reopened.db.acquisition
			.candidates(workKey)
			.filter(({ chosen }) => chosen)
			.map(({ episode }) => episode)
			.sort();
		expect(selected).toEqual(state === "bound" ? [1, 23, 24] : [1, 24]);

		f.target.availableEpisodes = Array.from(
			{ length: 23 },
			(_, index) => index + 1,
		);
		const revision = required(
			reopened.db.acquisition.subscription(workKey),
		).revision;
		await reopened.subscriptions.refresh(workKey, revision);
		expect(reopened.db.acquisition.source(saved.id)?.snapshot).toMatchObject({
			jackettHistory: { active: false, scan: { keywords: [{ offset: 5 }] } },
			nextAttemptAt: 3_100_000,
		});
		expect(calls).toHaveLength(6);
	},
);

test("empty discovery retains intent, freezes its creation scope, retries and survives reopen", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.search.mockResolvedValueOnce({
		entries: [],
		outcome: "no_match",
		coverage: { limited: false, reason: null, pages: 1, queries: 1 },
	});
	await f.subscriptions.resolvePending();
	expect(f.subscriptions.get(workKey).subscription).toMatchObject({
		sourceKind: "automatic",
		startEpisode: 3,
		error: "no_eligible_source",
	});
	required(f.snapshot.entries[0]).progress = 10;
	f.snapshot.revision = "new";
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.startEpisode).toBe(3);
	await f.watching.close();
	await f.subscriptions.close();
	await f.sources.runtime.close();
	f.db.close();
	const reopened = await f.open();
	expect(reopened.subscriptions.get(workKey).discovery?.attempts).toEqual([
		expect.objectContaining({ providerId: "nyaasi", outcome: "no_match" }),
	]);
	expect(
		reopened.subscriptions.get(workKey, { includeDiagnostics: false })
			.discovery,
	).toBeUndefined();
	f.advance();
	await reopened.subscriptions.resolvePending();
	expect(reopened.db.acquisition.authorization(workKey)?.startEpisode).toBe(3);
	const saved = reopened.db.acquisition.subscription(workKey);
	await reopened.watching.tick();
	await reopened.subscriptions.resolvePending();
	expect({
		...reopened.db.acquisition.subscription(workKey),
		schedule: null,
	}).toEqual({ ...saved, schedule: null });
	expect(f.search).toHaveBeenCalledTimes(2);
});

test("manual automatic-source subscriptions save before discovery and share the same pipeline", async () => {
	const f = await fixture();
	const saved = await f.subscriptions.save({
		workKey,
		revision: null,
		source: { kind: "automatic" },
		startEpisode: 1,
		profileId: "custom:instant",
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(saved.subscription).toMatchObject({
		sourceKind: "automatic",
		feedId: null,
		startEpisode: 1,
	});
	expect(f.search).not.toHaveBeenCalled();
	await f.enable();
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.revision).toBe(
		saved.subscription?.revision,
	);
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)?.startEpisode).toBe(1);
});

test.each(["remove", "edit", "pause"])(
	"late discovery cannot bind after user %s",
	async (action) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		await f.subscriptions.save({
			workKey,
			revision: required(f.db.acquisition.subscription(workKey)).revision,
			source: { kind: "automatic" },
			startEpisode: 3,
			profileId: "custom:instant",
			target: {
				destinationRevision: "destination",
				connectionGeneration: "downloader",
			},
		});
		let release: (() => void) | undefined;
		const implementation = required(f.search.getMockImplementation());
		f.search.mockImplementationOnce(async (...args) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return implementation(...args);
		});
		const pending = f.subscriptions.resolvePending();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		const sub = required(f.db.acquisition.subscription(workKey));
		if (action === "remove")
			await f.subscriptions.remove(workKey, sub.revision);
		else if (action === "pause")
			await f.subscriptions.setEnabled(workKey, sub.revision, false);
		else
			await f.subscriptions.save({
				workKey,
				revision: sub.revision,
				source: { kind: "feed", url: "https://example.org/new" },
				startEpisode: 1,
				target: null,
			});
		release?.();
		await pending;
		expect(f.db.acquisition.authorization(workKey)).toBeNull();
		if (action === "remove")
			expect(f.db.acquisition.subscription(workKey)).toBeNull();
		else
			expect(
				f.db.acquisition.subscription(workKey)?.sourceInput?.kind,
			).not.toBe("search");
	},
);

test("manual refresh bypasses collection cache while background discovery keeps its retry interval", async () => {
	const f = await fixture();
	const discover = vi.spyOn(SubscriptionDiscovery.prototype, "search");
	await f.enable();
	await f.watching.tick();
	f.search.mockResolvedValueOnce({
		entries: [],
		outcome: "no_match",
		coverage: { limited: true, reason: "item_limit", pages: 1, queries: 1 },
	});
	await f.subscriptions.resolvePending();
	expect(discover).toHaveBeenCalledTimes(1);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "no_match",
		limited: true,
	});
	await f.subscriptions.resolvePending();
	expect(discover).toHaveBeenCalledTimes(1);
	const revision = required(f.db.acquisition.subscription(workKey)).revision;
	await f.subscriptions.refresh(workKey, revision);
	expect(discover).toHaveBeenCalledTimes(2);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "matched",
	});
	expect(f.search).toHaveBeenCalledTimes(2);
	expect(f.db.acquisition.authorization(workKey)).not.toBeNull();
});

test("stopping an automatic subscription during assessment still publishes its shared manual source", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	const automatic = required(f.db.acquisition.subscription(workKey));
	const manualKey = "anilist:anime:2";
	await f.subscriptions.save({
		workKey: manualKey,
		revision: null,
		source: automatic.sourceInput ?? null,
		startEpisode: 1,
		profileId: "custom:instant",
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	const before = f.db.acquisition.candidates(workKey);
	f.downloads.mockImplementationOnce(async () => {
		f.watching.disable(f.watching.status().revision);
		return [];
	});
	await f.subscriptions.refreshSource(required(automatic.feedId));
	expect(f.db.acquisition.candidates(workKey)).toEqual(before);
	expect(f.db.acquisition.candidates(manualKey)).toHaveLength(1);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.subscriptions.selection().subscription(manualKey)?.enabled).toBe(
		true,
	);
	expect(f.subscriptions.activeSourceIds()).toEqual([automatic.feedId]);
});

test("Rewatching reuses local coverage and retains only missing release candidates", async () => {
	const f = await fixture();
	const entry = required(f.snapshot.entries[0]);
	entry.status = "rewatching";
	entry.progress = 2;
	f.target.availableEpisodes = [3];
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(
		f.subscriptions.get(workKey).discovery?.attempts[0]?.reasons,
	).toContain("already_available");
	f.target.availableEpisodes = [];
	f.advance();
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)).not.toBeNull();
	await f.subscriptions.refreshSource(
		required(f.db.acquisition.subscription(workKey)?.feedId),
	);
	expect(f.subscriptions.selection().candidates(workKey)).toEqual([
		expect.objectContaining({ episode: 3, status: "selected" }),
	]);
	const saved = f.db.acquisition.subscription(workKey);
	entry.status = "watching";
	await f.watching.tick();
	entry.status = "rewatching";
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	expect({ ...f.db.acquisition.subscription(workKey), schedule: null }).toEqual(
		{ ...saved, schedule: null },
	);
	expect(f.subscriptions.selection().candidates(workKey)).toHaveLength(1);
});
