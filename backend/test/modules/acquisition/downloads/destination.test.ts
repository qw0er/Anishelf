import { expect, test } from "vitest";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";

import {
	fixture,
	key,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("old subscriptions stay discovery-only until scoped confirmation and destination validation", async () => {
	const f = await fixture();
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	const config = await f.configure();
	await f.worker.tick();
	expect(f.add).not.toHaveBeenCalled();
	await f.authorize();
	await f.worker.tick();
	expect(f.add).toHaveBeenCalledTimes(1);
	expect(f.add.mock.calls[0]?.[0]).toMatchObject({
		savePath: "/downloads/Frieren [anilist-1]",
		ownerKey: f.worker.activity(key).items[0]?.id,
	});
	expect(f.worker.activity(key).authorized).toBe(true);
	const settings = await f.worker.saveDestination({
		revision: config.revision,
		scopeId: "root",
		path: "/new",
	});
	await f.worker.validate(settings.revision);
	expect(f.worker.activity(key).authorized).toBe(false);
});

test("invalid incomplete directories and removed resource roots prevent validation", async () => {
	const f = await fixture();
	const saved = await f.worker.saveDestination({
		revision: null,
		scopeId: "root",
		path: "/downloads",
	});
	f.probe.mockResolvedValueOnce({
		version: "5",
		incompleteDirectory: "/downloads/partial",
	});
	await expect(f.worker.validate(saved.revision)).rejects.toThrow();
	expect((await f.worker.settings()).destination?.validated).toBe(false);
});

test("bundled destination selects the matching root, retries failed validation, and keeps its revision", async () => {
	const f = await fixture(false, true);
	f.probe.mockRejectedValueOnce(new TorrentError("unavailable", "read"));
	await f.worker.tick();
	const pending = (await f.worker.settings()).destination;
	expect(pending).toMatchObject({
		scopeId: "root",
		path: "/data/media",
		validated: false,
	});
	await f.worker.tick();
	const ready = (await f.worker.settings()).destination;
	expect(ready).toMatchObject({
		revision: pending?.revision,
		validated: true,
		visibilityVerified: false,
	});
	await f.worker.tick();
	expect((await f.worker.settings()).destination?.revision).toBe(
		ready?.revision,
	);
	expect(f.add).not.toHaveBeenCalled();
});

test("a downloader without isolated staging cannot validate a destination", async () => {
	const f = await fixture();
	f.probe.mockResolvedValue({
		version: "another-engine",
		incompleteDirectory: null,
	});
	await expect(f.configure()).rejects.toThrow();
	expect((await f.worker.settings()).destination?.validated).toBe(false);
	expect(f.add).not.toHaveBeenCalled();
});
