import { expect, test, vi } from "vitest";
import { SubscriptionDiscovery } from "../../../src/modules/acquisition/subscriptions/application/discovery.js";

import {
	config,
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

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
		reopened.subscriptions.get(workKey, 1, false).discovery,
	).toBeUndefined();
	f.advance();
	await reopened.subscriptions.resolvePending();
	expect(reopened.db.acquisition.authorization(workKey)?.startEpisode).toBe(3);
	const saved = reopened.db.acquisition.subscription(workKey);
	await reopened.watching.tick();
	await reopened.subscriptions.resolvePending();
	expect(reopened.db.acquisition.subscription(workKey)).toEqual(saved);
	expect(f.search).toHaveBeenCalledTimes(2);
});

test("manual automatic-source subscriptions save before discovery and share the same pipeline", async () => {
	const f = await fixture();
	const saved = await f.subscriptions.save({
		workKey,
		revision: null,
		source: { kind: "automatic" },
		startEpisode: 1,
		profileId: config.profileId,
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
			profileId: config.profileId,
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

test("manual refresh reevaluates cached discovery and refetches only after expiry", async () => {
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
		outcome: "no_match",
	});
	expect(f.search).toHaveBeenCalledTimes(1);
	f.advance();
	await f.subscriptions.refresh(workKey, revision);
	expect(f.search).toHaveBeenCalledTimes(2);
	expect(f.subscriptions.get(workKey).discovery?.attempts[0]).toMatchObject({
		outcome: "matched",
	});
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
		profileId: config.profileId,
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
	expect(f.db.acquisition.subscription(workKey)).toEqual(saved);
	expect(f.subscriptions.selection().candidates(workKey)).toHaveLength(1);
});
