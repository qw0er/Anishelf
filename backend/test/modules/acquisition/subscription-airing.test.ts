import { expect, test } from "vitest";
import {
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();
const now = 1_000_000;
function upcoming(f: Awaited<ReturnType<typeof fixture>>) {
	f.target.airing = {
		status: "RELEASING",
		nextEpisode: { episode: 3, airingAt: now + 3600_000 },
		fetchedAt: now,
		stale: false,
		refreshError: false,
	};
}
async function manual(
	f: Awaited<ReturnType<typeof fixture>>,
	key = workKey,
	startEpisode = 3,
) {
	return f.subscriptions.save({
		workKey: key,
		revision: null,
		source: { kind: "automatic" },
		startEpisode,
		profileId: "custom:instant",
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
}
test.each(["manual", "watching"])(
	"%s subscriptions wait without resource requests and resume after airing plus fifteen minutes",
	async (kind) => {
		const f = await fixture();
		upcoming(f);
		if (kind === "watching") {
			await f.enable();
			await f.watching.tick();
		} else await manual(f);
		const original = required(f.db.acquisition.subscription(workKey));
		await f.subscriptions.resolvePending();
		expect(f.search).not.toHaveBeenCalled();
		expect(f.subscriptions.get(workKey).subscription).toMatchObject({
			schedule: { reason: "waiting_for_episode", nextCheckAt: now + 4500_000 },
			startEpisode: 3,
			revision: original.revision,
		});
		f.advanceBy(3600_000);
		await f.subscriptions.resolvePending();
		expect(f.search).not.toHaveBeenCalled();
		f.advanceBy(900_000);
		await f.subscriptions.resolvePending();
		expect(f.search).toHaveBeenCalledTimes(1);
		expect(f.db.acquisition.authorization(workKey)?.startEpisode).toBe(3);
	},
);
test("manual checks search before airing, bypass collection cache and preserve the background wait", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	const revision = required(f.db.acquisition.subscription(workKey)).revision;
	await f.subscriptions.refresh(workKey, revision);
	expect(f.search).toHaveBeenCalledTimes(1);
	const saved = required(f.db.acquisition.subscription(workKey));
	expect(saved.schedule?.reason).toBe("waiting_for_episode");
	expect(f.subscriptions.selection().candidates(workKey)[0]?.status).toBe(
		"selected",
	);
	await f.subscriptions.refresh(workKey, saved.revision);
	expect(f.search).toHaveBeenCalledTimes(2);
	await f.subscriptions.refreshSource(required(saved.feedId));
	expect(f.search).toHaveBeenCalledTimes(2);
});
test("unknown premiere time only checks metadata; stale and unavailable information restores bounded search", async () => {
	const f = await fixture();
	upcoming(f);
	required(f.target.airing).status = "NOT_YET_RELEASED";
	required(f.target.airing).nextEpisode = null;
	await manual(f);
	await f.subscriptions.resolvePending();
	expect(f.search).not.toHaveBeenCalled();
	expect(f.subscriptions.get(workKey).subscription?.schedule).toMatchObject({
		reason: "waiting_for_premiere",
		nextCheckAt: null,
	});
	required(f.target.airing).stale = true;
	await f.subscriptions.resolvePending();
	expect(f.search).toHaveBeenCalledTimes(1);
	expect(f.subscriptions.get(workKey).subscription?.schedule).toMatchObject({
		reason: "fallback",
		metadataFresh: false,
	});
});
test("schedule changes and restarts cannot move an already-due check into the future", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	await f.subscriptions.resolvePending();
	const first = required(f.db.acquisition.subscription(workKey));
	required(required(f.target.airing).nextEpisode).airingAt = now + 7200_000;
	await f.subscriptions.resolvePending();
	expect(f.search).not.toHaveBeenCalled();
	expect(f.db.acquisition.subscription(workKey)?.schedule?.nextCheckAt).toBe(
		now + 8100_000,
	);
	await f.watching.close();
	await f.subscriptions.close();
	await f.sources.runtime.close();
	f.db.close();
	f.advanceBy(8100_000);
	const reopened = await f.open();
	await reopened.subscriptions.resolvePending();
	expect(f.search).toHaveBeenCalledTimes(1);
	expect(reopened.db.acquisition.subscription(workKey)?.startEpisode).toBe(
		first.startEpisode,
	);
});
test("airing corrections that make a waiting episode available wake discovery before its old deadline", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	await f.subscriptions.resolvePending();
	required(required(f.target.airing).nextEpisode).airingAt = now - 3600_000;
	await f.subscriptions.resolvePending();
	expect(f.search).toHaveBeenCalledTimes(1);
});
test("waiting works do not starve backlog discovery", async () => {
	const f = await fixture();
	upcoming(f);
	for (let id = 1; id <= 6; id++)
		await manual(f, `anilist:anime:${id}`, id === 6 ? 2 : 3);
	await f.subscriptions.resolvePending();
	expect(f.search).toHaveBeenCalledTimes(1);
	expect(
		f.db.acquisition.subscription("anilist:anime:6")?.feedId,
	).not.toBeNull();
	expect(f.db.acquisition.subscription(workKey)?.feedId).toBeNull();
});
test("shared sources use the earliest consumer deadline and can supply early resources without extra polling", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	await f.subscriptions.refresh(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	const waiting = required(f.db.acquisition.subscription(workKey));
	await manual(f, "anilist:anime:2", 2);
	await f.subscriptions.resolvePending();
	const backlog = required(f.db.acquisition.subscription("anilist:anime:2"));
	expect(backlog.feedId).toBe(waiting.feedId);
	const feed = required(f.sources.api.snapshot(required(waiting.feedId)));
	expect(f.subscriptions.sourceNextCheckAt(feed)).toBeLessThan(
		required(waiting.schedule?.nextCheckAt),
	);
	expect(f.subscriptions.selection().candidates(workKey)[0]?.status).toBe(
		"selected",
	);
});
test("schedule-only writes are fenced by the subscription revision and preserve candidates and authorization", async () => {
	const f = await fixture();
	await manual(f);
	await f.subscriptions.resolvePending();
	const sub = required(f.db.acquisition.subscription(workKey));
	const schedule = required(sub.schedule);
	const authorization = f.db.acquisition.authorization(workKey),
		candidates = f.db.acquisition.candidates(workKey);
	expect(f.db.acquisition.saveSchedule(workKey, "stale", schedule)).toBe(false);
	expect(
		f.db.acquisition.saveSchedule(workKey, sub.revision, {
			...schedule,
			nextCheckAt: now + 3600_000,
		}),
	).toBe(true);
	expect(f.db.acquisition.subscription(workKey)?.revision).toBe(sub.revision);
	expect(f.db.acquisition.authorization(workKey)).toEqual(authorization);
	expect(f.db.acquisition.candidates(workKey)).toEqual(candidates);
});

test("manual refresh cannot bypass a source rate-limit cooldown", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	await f.subscriptions.refresh(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	const sub = required(f.db.acquisition.subscription(workKey));
	const source = required(f.db.acquisition.source(required(sub.feedId)));
	f.db.acquisition.saveSource({
		...source,
		failures: 1,
		snapshot: {
			...required(source.snapshot),
			error: "rate_limited",
			nextAttemptAt: now + 3600_000,
		},
	});
	const calls = f.search.mock.calls.length;
	await f.subscriptions.refresh(workKey, sub.revision);
	expect(f.search).toHaveBeenCalledTimes(calls);
	expect(f.sources.api.snapshot(required(sub.feedId))?.nextAttemptAt).toBe(
		now + 3600_000,
	);
});
test("an asynchronous scheduling read cannot overwrite a subscription edit", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	const initial = required(f.db.acquisition.subscription(workKey));
	let release: ((target: typeof f.target) => void) | undefined;
	f.readTarget.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const checking = f.subscriptions.checkCompletion();
	const edited = await f.subscriptions.save({
		workKey,
		revision: initial.revision,
		source: { kind: "automatic" },
		startEpisode: 4,
		target: {
			destinationRevision: "destination",
			connectionGeneration: "downloader",
		},
	});
	required(release)(f.target);
	await checking;
	expect(f.db.acquisition.subscription(workKey)).toMatchObject({
		revision: edited.subscription?.revision,
		startEpisode: 4,
	});
	expect(f.db.acquisition.subscription(workKey)?.schedule).toBeUndefined();
	expect(f.search).not.toHaveBeenCalled();
});

test("an explicit check promotes a concurrent background metadata check instead of being swallowed", async () => {
	const f = await fixture();
	upcoming(f);
	await manual(f);
	await f.subscriptions.refresh(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	const sub = required(f.db.acquisition.subscription(workKey));
	let release: ((target: typeof f.target) => void) | undefined;
	f.readTarget.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const background = f.subscriptions.refreshSource(required(sub.feedId));
	const explicit = f.subscriptions.refresh(workKey, sub.revision);
	required(release)(f.target);
	await Promise.all([background, explicit]);
	expect(f.search).toHaveBeenCalledTimes(2);
});
