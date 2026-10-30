import { expect, test, vi } from "vitest";

import {
	config,
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

test("Watching only accepts the subscription default and fences default changes before confirmation and new creation", async () => {
	const f = await fixture();
	await expect(
		f.watching.preview("session", f.watching.status().revision, {
			...config,
			profileId: "custom:independent",
		}),
	).rejects.toThrow(/Preview and confirm/);
	const preview = await f.watching.preview(
		"session",
		f.watching.status().revision,
		config,
	);
	f.setDefaultProfile("custom:new-default");
	expect(() => f.watching.confirm("session", preview.id)).toThrow(
		/Preview and confirm/,
	);
	f.setDefaultProfile(config.profileId);
	await f.enable();
	await f.watching.tick();
	const existing = f.db.acquisition.subscription(workKey);
	f.setDefaultProfile("custom:new-default");
	f.snapshot.entries.push({
		workKey: "anilist:anime:2",
		title: "Another work",
		status: "watching",
		progress: 0,
	});
	f.snapshot.revision = "default-changed";
	expect(f.watching.status().reason).toBe("profile_changed");
	await f.watching.tick();
	expect(f.db.acquisition.subscription("anilist:anime:2")).toBeNull();
	expect(f.db.acquisition.subscription(workKey)).toEqual(existing);
});

test("default-off previews do not search; Watching creates a group-managed pending subscription", async () => {
	const f = await fixture();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	const preview = await f.watching.preview("session", "unconfigured", config);
	expect(f.search).not.toHaveBeenCalled();
	expect(() => f.watching.confirm("other", preview.id)).toThrow();
	f.watching.confirm("session", preview.id);
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toMatchObject({
		feedId: null,
		startEpisode: 3,
		enabled: true,
		createdBy: "watching",
	});
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
	expect(f.search).not.toHaveBeenCalled();
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.authorization(workKey)).toMatchObject({
		startEpisode: 3,
		destinationRevision: "destination",
	});
});

test.each(["destination", "source"])(
	"pending discovery cannot inherit changed %s configuration",
	async (change) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		if (change === "destination") f.destination.revision = "changed";
		else
			await f.sources.api.connector.clear(
				f.sources.api.connector.settings().generation,
			);
		await f.subscriptions.resolvePending();
		expect(f.db.acquisition.authorization(workKey)).toBeNull();
		expect(f.subscriptions.get(workKey).subscription?.runState).toBe(
			`${change}_changed`,
		);
		expect(f.search).not.toHaveBeenCalled();
	},
);

test("failed authorization rolls back source binding while keeping pending intent", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	vi.spyOn(f.db.acquisition, "authorize").mockImplementationOnce(() => {
		throw Error("injected failure");
	});
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.subscription(workKey)).toMatchObject({
		feedId: null,
		lastError: "discovery_unavailable",
		startEpisode: 3,
	});
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
});

test("invalid progress does not starve eligible work or fabricate a starting episode", async () => {
	const f = await fixture();
	f.snapshot.entries = [
		...Array.from({ length: 5 }, (_, i) => ({
			workKey: `anilist:anime:${i + 2}`,
			title: "Invalid",
			status: "watching",
			progress: 10000,
		})),
		...f.snapshot.entries,
	];
	await f.enable();
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)?.startEpisode).toBe(3);
	expect(f.db.acquisition.subscriptions()).toHaveLength(1);
});

test("stale, expired and changed-account activation scopes cannot create subscriptions", async () => {
	const f = await fixture();
	const preview = await f.watching.preview("session", "unconfigured", config);
	f.advance();
	expect(() => f.watching.confirm("session", preview.id)).toThrow();
	await f.enable();
	f.snapshot.accountId = "other";
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).toBeNull();
});

test("capacity and Tracking backoff are respected without discovery", async () => {
	const f = await fixture();
	await f.enable();
	const capacity = vi
		.spyOn(f.subscriptions, "hasCapacity")
		.mockReturnValue(false);
	await f.watching.tick();
	expect(f.watching.status().works[0]?.reason).toBe("subscription_limit");
	capacity.mockReturnValue(true);
	f.snapshot.fresh = false;
	f.snapshot.refreshAllowed = false;
	f.refresh.mockClear();
	await f.watching.tick();
	expect(f.refresh).not.toHaveBeenCalled();
	f.snapshot.fresh = true;
	await f.watching.tick();
	expect(f.db.acquisition.subscription(workKey)).not.toBeNull();
});

test("disabling during discovery prevents a late source binding and permission", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	const search = f.search.getMockImplementation();
	f.search.mockImplementationOnce(async (...args) => {
		f.watching.disable(f.watching.status().revision);
		return required(search)(...args);
	});
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.subscription(workKey)?.feedId).toBeNull();
	expect(f.db.acquisition.authorization(workKey)).toBeNull();
});
