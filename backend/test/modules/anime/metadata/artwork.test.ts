import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { metadataDefaults } from "../../../../src/modules/anime/metadata/defaults.js";
import { MetadataArtworkCache } from "../../../../src/modules/anime/metadata/infrastructure/artwork.js";

import {
	cleanups,
	failure,
	logger,
	media,
	png,
	setup,
	setupTestLifecycle,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("artwork is validated, atomically cached, served offline and reconciled on restart", async () => {
	const { artwork, database, dir, fetcher } = await setup();
	fetcher.mockImplementationOnce(async () => new Response(png));
	const ready = await artwork.get(
		"work-cover",
		media().coverImage.extraLarge,
		{},
	);
	expect(ready.status).toBe("ready");
	if (!ready.id) throw new Error("Missing artwork ID");
	expect((await artwork.read(ready.id)).bytes).toEqual(png);
	// Warm lookups stay provider-free so list cards can link content addresses.
	expect(await artwork.cached("work-cover")).toBe(ready.id);
	expect(await artwork.cached("unknown-cover")).toBeNull();
	expect(
		(
			await artwork.get("work-cover", media().coverImage.extraLarge, {
				cachedOnly: true,
			})
		).id,
	).toBe(ready.id);
	expect(fetcher).toHaveBeenCalledTimes(1);
	await writeFile(
		join(dir, "cache", "metadata-artwork", "orphan.pending"),
		"partial",
	);
	await rm(join(dir, "cache", "metadata-artwork", ready.id));
	await artwork.initialize();
	expect(database.metadata.artworks()).toEqual([]);
	await expect(
		readFile(join(dir, "cache", "metadata-artwork", "orphan.pending")),
	).rejects.toThrow();
});

test("artwork denies arbitrary hosts/redirects, non-images and excessive bytes", async () => {
	const { artwork, fetcher } = await setup();
	expect(
		(await artwork.get("bad-host", "https://localhost/private", {})).status,
	).toBe("failed");
	expect(fetcher).not.toHaveBeenCalled();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1/private" },
			}),
	);
	expect(
		(await artwork.get("redirect", media().coverImage.extraLarge, {})).status,
	).toBe("failed");
	expect(fetcher).toHaveBeenCalledTimes(1);
	fetcher.mockImplementationOnce(async () => new Response("not an image"));
	expect(
		(await artwork.get("invalid", media().coverImage.extraLarge, {})).failure
			?.code,
	).toBe("invalid-response");
	fetcher.mockImplementationOnce(
		async () =>
			new Response(png, {
				headers: {
					"content-length": String(metadataDefaults.artworkMaximumBytes + 1),
				},
			}),
	);
	expect(
		(await artwork.get("oversized", media().coverImage.extraLarge, {})).failure
			?.code,
	).toBe("invalid-response");
	await failure(artwork.read("../../private"), "not-found");
});

test("artwork downloads keep bounded concurrency and deduplicate identical requests", async () => {
	const { dir, database } = await setup();
	let active = 0;
	let peak = 0;
	const releases: (() => void)[] = [];
	const fetcher = vi.fn<typeof fetch>(async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise<void>((resolve) => releases.push(resolve));
		active--;
		return new Response(png);
	});
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		fetch: fetcher,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	const url = (name: string) => `https://s4.anilist.co/${name}.png`;
	const requests = Array.from({ length: 6 }, (_, index) =>
		artwork.get(`key-${index}`, url(`art-${index}`), {}),
	);
	// A second request for an in-flight image joins that download instead of fetching.
	const duplicate = artwork.get("key-0", url("art-0"), {});
	const settled = Promise.all([...requests, duplicate]);
	for (let round = 0; round < 10; round++) {
		while (releases.length > 0) releases.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	const statuses = await settled;
	expect(fetcher).toHaveBeenCalledTimes(6);
	expect(peak).toBe(4);
	expect(statuses.every((status) => status.status === "ready")).toBe(true);
});

test("a requested artwork refresh serves cached bytes and refreshes in the background", async () => {
	const { dir, database } = await setup();
	const debug = vi.spyOn(logger, "debug");
	const fetcher = vi.fn<typeof fetch>(async () => new Response(png));
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		logger,
		fetch: fetcher,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	const url = media().coverImage.extraLarge;
	const first = await artwork.get("key", url, {});
	if (!first.id) throw new Error("Missing artwork ID");
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	fetcher.mockImplementationOnce(async () => {
		await gate;
		return new Response(png);
	});
	const refreshed = await artwork.get("key", url, { refresh: true });
	expect(refreshed).toMatchObject({ id: first.id, status: "ready" });
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(debug).toHaveBeenCalledWith(
		expect.objectContaining({ event: "metadata.artwork_refresh_started" }),
		expect.any(String),
	);
	release();
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(database.metadata.artworks()).toHaveLength(1);
});

test("artwork failure preserves the previous usable URL version and budget evicts LRU", async () => {
	const warn = vi.spyOn(logger, "warn");
	const debug = vi.spyOn(logger, "debug");
	const { dir, database, fetcher } = await setup();
	const artwork = new MetadataArtworkCache({
		hosts: ["s4.anilist.co"],
		dataDir: dir,
		store: database.metadata,
		logger,
		fetch: fetcher,
		budgetBytes: png.length,
	});
	await artwork.initialize();
	cleanups.push(() => artwork.close());
	fetcher.mockImplementationOnce(async () => new Response(png));
	const first = await artwork.get("key", media().coverImage.extraLarge, {});
	fetcher.mockImplementationOnce(
		async () => new Response(null, { status: 500 }),
	);
	const retained = await artwork.get(
		"key",
		"https://s4.anilist.co/new.png",
		{},
	);
	expect(retained).toMatchObject({
		id: first.id,
		status: "ready",
		failure: { code: "unavailable" },
	});
	fetcher.mockImplementationOnce(async () => new Response(png));
	await artwork.get("other", "https://s4.anilist.co/other.png", {});
	expect(database.metadata.artworks()).toHaveLength(1);
	expect(warn).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "metadata.artwork_failed",
			retained: true,
			code: "unavailable",
		}),
		expect.any(String),
	);
	expect(debug).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "metadata.artwork_evicted",
			artworkId: first.id,
		}),
		expect.any(String),
	);
	expect(
		JSON.stringify([...warn.mock.calls, ...debug.mock.calls]),
	).not.toContain("https://s4.anilist.co/");
});
