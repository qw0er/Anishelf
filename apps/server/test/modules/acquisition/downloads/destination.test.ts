import { win32 } from "node:path";
import { expect, test } from "vitest";
import {
	absoluteDownloadPath,
	sameDownloadPath,
} from "../../../../src/modules/acquisition/downloads/application/destination-paths.js";
import { TorrentError } from "../../../../src/modules/acquisition/torrent-clients/public.js";
import { pathContains } from "../../../../src/platform/paths.js";

import {
	fixture,
	fixturePath,
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
		savePath: fixturePath("downloads/Frieren [anilist-1]"),
		ownerKey: f.worker.activity(key).items[0]?.id,
	});
	expect(f.worker.activity(key).authorized).toBe(true);
	const settings = await f.worker.saveDestination({
		revision: config.revision,
		scopeId: "root",
		path: fixturePath("new"),
	});
	await f.worker.validate(settings.revision);
	expect(f.worker.activity(key).authorized).toBe(false);
});

test("invalid incomplete directories and removed resource roots prevent validation", async () => {
	const f = await fixture();
	const saved = await f.worker.saveDestination({
		revision: null,
		scopeId: "root",
		path: fixturePath("downloads"),
	});
	f.probe.mockResolvedValueOnce({
		version: "5",
		incompleteDirectory: fixturePath("downloads/partial"),
	});
	await expect(f.worker.validate(saved.revision)).rejects.toThrow();
	expect((await f.worker.settings()).destination?.validated).toBe(false);
});

test.skipIf(process.platform === "win32")(
	"bundled destination selects the matching root, retries failed validation, and keeps its revision",
	async () => {
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
	},
);

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

test("Windows destinations normalize drive and UNC paths and compare downloader echoes", () => {
	expect(absoluteDownloadPath("C:/Downloads/", win32)).toBe(
		String.raw`C:\Downloads`,
	);
	expect(absoluteDownloadPath("//nas/share/downloads/", win32)).toBe(
		String.raw`\\nas\share\downloads`,
	);
	expect(
		sameDownloadPath(
			"c:/downloads/Anime/",
			String.raw`C:\Downloads\Anime`,
			win32,
		),
	).toBe(true);
	expect(
		sameDownloadPath("//NAS/share/anime", String.raw`\\nas\share\ANIME`, win32),
	).toBe(true);
	expect(pathContains("C:/Media", String.raw`C:\Incomplete`, win32)).toBe(
		false,
	);
	expect(pathContains("C:/Media", String.raw`c:\media\Incomplete`, win32)).toBe(
		true,
	);
	expect(pathContains("C:/Media", "D:/Media", win32)).toBe(false);
	for (const path of [
		"C:Downloads",
		"/Downloads",
		"//server",
		"C:/Downloads/../Outside",
		"C:/Downloads/.. /Outside",
		"C:/Downloads/file:stream",
		String.raw`\\?\C:\Downloads`,
	])
		expect(() => absoluteDownloadPath(path, win32)).toThrow(
			expect.objectContaining({ code: "invalid_destination" }),
		);
});
