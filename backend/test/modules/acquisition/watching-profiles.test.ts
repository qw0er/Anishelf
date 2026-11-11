import { expect, test, vi } from "vitest";
import {
	fixture,
	required,
	setupTestLifecycle,
	workKey,
} from "./support/watching-automation-fixture.js";

setupTestLifecycle();

test("unreserved choices are invalidated immediately and reassessed from cached sources", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	await f.subscriptions.refresh(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	const initial = required(f.db.acquisition.subscription(workKey));
	const before = f.subscriptions.selection().candidates(workKey);
	expect(before[0]?.status).toBe("selected");
	f.setDefaultProfile("custom:other");
	expect(f.subscriptions.selection().candidates(workKey)[0]).toMatchObject({
		status: "skipped",
		reasons: ["profile_changed"],
	});
	const calls = f.search.mock.calls.length;
	await f.subscriptions.resolvePending();
	expect(f.search).toHaveBeenCalledTimes(calls);
	expect(f.subscriptions.selection().candidates(workKey)[0]).toMatchObject({
		status: "selected",
		selection: { profileId: "custom:other" },
	});
	expect(f.db.acquisition.subscription(workKey)).toEqual(initial);
});

test.each([false, true])(
	"a profile change during candidate assessment cannot publish stale choices (ABA: %s)",
	async (aba) => {
		const f = await fixture();
		await f.enable();
		await f.watching.tick();
		await f.subscriptions.resolvePending();
		await f.subscriptions.refresh(
			workKey,
			required(f.db.acquisition.subscription(workKey)).revision,
		);
		const before = f.db.acquisition.candidates(workKey);
		const downloads = required(f.downloads.getMockImplementation());
		f.downloads.mockImplementationOnce(async () => {
			f.setDefaultProfile("custom:other");
			if (aba) f.setDefaultProfile("custom:instant");
			return downloads();
		});
		f.advance();
		const sub = required(f.db.acquisition.subscription(workKey));
		await f.subscriptions.refresh(workKey, sub.revision);
		expect(f.db.acquisition.candidates(workKey)).toEqual(before);
		expect(f.subscriptions.selection().candidates(workKey)[0]?.status).toBe(
			"skipped",
		);
		await f.subscriptions.resolvePending();
		expect(f.subscriptions.selection().candidates(workKey)[0]?.status).toBe(
			"selected",
		);
	},
);

test("unavailable defaults preserve frozen reservations and their submission authorization", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	await f.subscriptions.refresh(
		workKey,
		required(f.db.acquisition.subscription(workKey)).revision,
	);
	const selected = f.subscriptions.selection().candidates(workKey);
	const candidate = required(selected[0]);
	// The store's lock capability is the same reservation boundary used by Downloads.
	const locked = vi
		.spyOn(f.db.acquisitionDownloads, "lockedCandidates")
		.mockReturnValue([candidate.id]);
	f.setDefaultProfile("custom:missing");
	expect(f.subscriptions.get(workKey).subscription?.runState).toBe(
		"profile_unavailable",
	);
	expect(f.subscriptions.selection().subscription(workKey)?.enabled).toBe(true);
	expect(f.subscriptions.selection().candidates(workKey)).toEqual(selected);
	locked.mockRestore();
});

test("cached reassessment does not overwrite choices after source evidence changes", async () => {
	const f = await fixture();
	await f.enable();
	await f.watching.tick();
	await f.subscriptions.resolvePending();
	const sub = required(f.db.acquisition.subscription(workKey));
	await f.subscriptions.refresh(workKey, sub.revision);
	const before = f.db.acquisition.candidates(workKey);
	f.setDefaultProfile("custom:other");
	f.advance();
	const downloads = required(f.downloads.getMockImplementation());
	f.downloads.mockImplementationOnce(async () => {
		const publication = await f.sources.api.fetch(required(sub.sourceInput));
		publication.commit(() => {});
		return downloads();
	});
	await f.subscriptions.resolvePending();
	expect(f.db.acquisition.candidates(workKey)).toEqual(before);
	expect(f.subscriptions.selection().candidates(workKey)[0]?.status).toBe(
		"skipped",
	);
	await f.subscriptions.resolvePending();
	expect(f.subscriptions.selection().candidates(workKey)[0]).toMatchObject({
		status: "selected",
		selection: { profileId: "custom:other" },
	});
});
