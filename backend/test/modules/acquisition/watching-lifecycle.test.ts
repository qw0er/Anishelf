import { expect, test } from "vitest";

import {
	config,
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

test("Watching group gates existing subscriptions while manual takeover and pause remain independent", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	const saved = required(f.db.acquisition.subscription(workKey));
	for (const status of [
		"paused",
		"completed",
		"dropped",
		"watching",
		"rewatching",
	]) {
		required(f.snapshot.entries[0]).status = status;
		f.snapshot.revision = status;
		await f.watching.tick();
		expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
			status === "watching" || status === "rewatching",
		);
	}
	f.snapshot.fresh = false;
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	f.snapshot.fresh = true;
	f.watching.disable(f.watching.status().revision);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.subscriptions.activeSourceIds()).toEqual([]);
	await expect(
		f.subscriptions.setEnabled(workKey, saved.revision, true),
	).rejects.toThrow(/Watching settings/);
	const taken = await f.subscriptions.save({
		workKey,
		revision: saved.revision,
		source: null,
		startEpisode: 2,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(taken.subscription).toMatchObject({
		management: "manual",
		runState: "active",
	});
	f.snapshot.accountId = "different";
	f.snapshot.generation = "different";
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	const paused = await f.subscriptions.setEnabled(
		workKey,
		required(taken.subscription).revision,
		false,
	);
	const edited = await f.subscriptions.save({
		workKey,
		revision: paused.subscription?.revision ?? null,
		source: null,
		startEpisode: 2,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	expect(edited.subscription?.enabled).toBe(false);
});

test("manual unsubscribe suppresses automatic recreation; explicit inclusion allows a new subscription", async () => {
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
	await f.subscriptions.remove(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
	const row = required(f.watching.status().works[0]);
	expect(row.excluded).toBe(true);
	f.watching.override({
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: row.revision,
		excluded: false,
		paused: false,
	});
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
});

test("exclusion stops an existing automatic subscription and inclusion restores it without recreation", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const sub = required(f.db.acquisition.subscription(workKey));
	const row = required(f.watching.status().works[0]);
	f.watching.override({
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: row.revision,
		excluded: true,
		paused: false,
	});
	await f.subscriptions.resolvePending();
	expect(f.search).not.toHaveBeenCalled();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("excluded");
	const excluded = required(f.watching.status().works[0]);
	f.watching.override({
		accountId: required(f.snapshot.accountId),
		trackingGeneration: f.snapshot.generation,
		workKey,
		revision: excluded.revision,
		excluded: false,
		paused: false,
	});
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.subscription(workKey)?.startEpisode).toBe(
		sub.startEpisode,
	);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
});

test("full local coverage completes both ownership kinds; count growth reopens, manual pauses survive", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.target.work.episodeCount = 4;
	f.target.availableEpisodes = [3];
	await f.subscriptions.resolvePending();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("active");
	f.target.availableEpisodes = [3, 4];
	await f.subscriptions.checkCompletion();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("completed");
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(
		false,
	);
	expect(f.subscriptions.activeSourceIds()).toEqual([]);
	f.watching.disable(f.watching.status().revision);
	f.target.work.episodeCount = 5;
	await f.subscriptions.checkCompletion();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("disabled");
	const current = required(f.db.acquisition.subscription(workKey));
	await f.subscriptions.save({
		workKey,
		revision: current.revision,
		source: null,
		startEpisode: 3,
		profileId: config.profileId,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	f.target.availableEpisodes = [3, 4, 5];
	await f.subscriptions.checkCompletion();
	const completed = required(f.subscriptions.get(workKey).subscription);
	expect(completed.runState).toBe("completed");
	await f.subscriptions.setEnabled(workKey, completed.revision, true);
	await f.subscriptions.checkCompletion();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("active");
	const resumed = required(f.subscriptions.get(workKey).subscription);
	await f.subscriptions.setEnabled(workKey, resumed.revision, false);
	f.target.work.episodeCount = 6;
	await f.subscriptions.checkCompletion();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("paused");
});

test("completed automatic records survive restart and explicit resume still obeys the group switch", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.target.work.episodeCount = 3;
	f.target.availableEpisodes = [3];
	await f.subscriptions.checkCompletion();
	const completed = required(f.db.acquisition.subscription(workKey));
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("completed");
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.revision).toBe(
		completed.revision,
	);
	await f.watching.close();
	await f.subscriptions.close();
	await f.sources.runtime.close();
	f.db.close();
	const reopened = await f.open();
	expect(reopened.subscriptions.get(workKey).subscription?.runState).toBe(
		"completed",
	);
	reopened.watching.disable(reopened.watching.status().revision);
	await reopened.subscriptions.setEnabled(workKey, completed.revision, true);
	await reopened.subscriptions.checkCompletion();
	expect(reopened.subscriptions.get(workKey).subscription?.runState).toBe(
		"disabled",
	);
	const preview = await reopened.watching.preview(
		"resume",
		reopened.watching.status().revision,
		config,
	);
	reopened.watching.confirm("resume", preview.id);
	expect(reopened.subscriptions.get(workKey).subscription?.runState).toBe(
		"active",
	);
});

test.each([null, 0, 2, 3.5, 10001])(
	"unknown or invalid total %s never completes a subscription",
	async (total) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		f.target.work.episodeCount = total;
		f.target.availableEpisodes = [1, 2, 3, 4];
		await f.subscriptions.checkCompletion();
		expect(f.subscriptions.get(workKey).subscription?.runState).toBe("active");
	},
);

test("renewal preserves manual priority and repairs managed pending scope after source and destination changes", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.destination.revision = "new-destination";
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe(
		"destination_changed",
	);
	const preview = await f.enable();
	expect(preview.destination).toBe("/downloads");
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)?.destinationRevision).toBe(
		"new-destination",
	);
});

test.each(["watching", "rewatching"])(
	"%s transitions preserve automatic intent and configuration",
	async (initial) => {
		const f = await fixture();
		const entry = required(f.snapshot.entries[0]);
		entry.status = initial;
		await f.enable();
		await f.watching.tick();
		await f.subscriptions.resolvePending();
		const saved = required(f.db.acquisition.subscription(workKey));
		const authorization = f.db.acquisition.authorization(workKey);
		for (const status of [
			"rewatching",
			"watching",
			"rewatching",
			"paused",
			"completed",
			"dropped",
			"planned",
			"rewatching",
		]) {
			entry.status = status;
			entry.progress = 8;
			f.snapshot.revision = `${initial}-${status}`;
			await f.watching.tick();
			expect(f.db.acquisition.subscription(workKey)).toEqual(saved);
			expect(f.db.acquisition.authorization(workKey)).toEqual(authorization);
			expect(f.subscriptions.get(workKey).subscription?.runState).toBe(
				status === "watching" || status === "rewatching"
					? "active"
					: "not_watching",
			);
		}
	},
);

test("entering Rewatching leaves completed subscriptions completed without new discovery", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	f.target.work.episodeCount = 3;
	f.target.availableEpisodes = [3];
	await f.subscriptions.checkCompletion();
	const saved = f.db.acquisition.subscription(workKey);
	required(f.snapshot.entries[0]).status = "rewatching";
	required(f.snapshot.entries[0]).progress = 0;
	f.snapshot.revision = "rewatching";
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe("completed");
	expect(f.db.acquisition.subscription(workKey)).toEqual(saved);
	expect(f.search).not.toHaveBeenCalled();
});
