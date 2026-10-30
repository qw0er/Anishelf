import { toTorrentFile } from "parse-torrent";
import { expect, test, vi } from "vitest";
import {
	absoluteDownloadPath,
	relativeDownloadPath,
	workDirectory,
} from "../../../../src/modules/acquisition/downloads/domain/paths.js";
import { resolveTorrent } from "../../../../src/modules/acquisition/downloads/infrastructure/torrent.js";

import {
	hash,
	key,
	readerFor,
	setupTestLifecycle,
} from "./support/acquisition-downloads-fixture.js";

setupTestLifecycle();

test("torrent parser verifies canonical magnet identity and rejects pure v2 and mismatched feed hashes", async () => {
	const transport = { read: vi.fn(), close: vi.fn() };
	const signal = new AbortController().signal;
	expect(
		(
			await resolveTorrent(
				{ download: `magnet:?xt=urn:btih:${hash.toUpperCase()}`, hash },
				readerFor(transport),
				signal,
			)
		).hash,
	).toBe(hash);
	await expect(
		resolveTorrent(
			{ download: `magnet:?xt=urn:btih:${hash}`, hash: "b".repeat(40) },
			readerFor(transport),
			signal,
		),
	).rejects.toMatchObject({ code: "torrent_identity_conflict" });
	await expect(
		resolveTorrent(
			{ download: `magnet:?xt=urn:btmh:1220${"a".repeat(64)}`, hash: null },
			readerFor(transport),
			signal,
		),
	).rejects.toThrow();
});

test("destination and torrent paths reject escapes and directory names remain bounded", () => {
	for (const path of ["../x", "/x", "a/../x", "a\\x", "a//x"])
		expect(() => relativeDownloadPath(path)).toThrow();
	for (const path of ["relative", "/a/../b", "C:\\media"])
		expect(() => absoluteDownloadPath(path)).toThrow();
	expect(workDirectory(key, "Frieren")).toBe("Frieren [anilist-1]");
	expect(
		Buffer.byteLength(workDirectory(key, "动画".repeat(200))),
	).toBeLessThanOrEqual(240);
	expect(workDirectory("anilist:anime:2", "Frieren")).not.toBe(
		workDirectory(key, "Frieren"),
	);
});

test("v1 and hybrid torrent bytes resolve consistently and reject unsafe original path components", async () => {
	const bytes = (hybrid = false, name = "Frieren - 03.mkv") =>
		toTorrentFile({
			infoHash: "",
			announce: [],
			urlList: [],
			info: {
				name: Buffer.from(name),
				length: 100,
				"piece length": 16384,
				pieces: Buffer.alloc(20),
				...(hybrid
					? {
							"meta version": 2,
							"file tree": {
								[name]: {
									"": { length: 100, "pieces root": Buffer.alloc(32) },
								},
							},
						}
					: {}),
			},
		});
	const transport = {
		read: vi.fn(async () => new Uint8Array(bytes())),
		close: async () => {},
	};
	const first = await resolveTorrent(
		{ download: "https://example.org/episode.torrent", hash: null },
		readerFor(transport),
		new AbortController().signal,
	);
	expect(first.hash).toMatch(/^[a-f0-9]{40}$/);
	transport.read.mockResolvedValueOnce(new Uint8Array(bytes(true)));
	const hybrid = await resolveTorrent(
		{ download: "https://example.org/episode.torrent", hash: null },
		readerFor(transport),
		new AbortController().signal,
	);
	expect(hybrid.hash).toMatch(/^[a-f0-9]{40}$/);
	transport.read.mockResolvedValueOnce(
		new Uint8Array(bytes(false, "../escape.mkv")),
	);
	await expect(
		resolveTorrent(
			{ download: "https://example.org/episode.torrent", hash: null },
			readerFor(transport),
			new AbortController().signal,
		),
	).rejects.toMatchObject({ code: "invalid_file_path" });
});
