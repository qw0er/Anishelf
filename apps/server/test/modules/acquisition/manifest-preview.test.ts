import { setTimeout as wait } from "node:timers/promises";
import { toTorrentFile } from "parse-torrent";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { inspectTorrentContent } from "../../../src/modules/acquisition/downloads/infrastructure/torrent.js";
import { ManifestPreview } from "../../../src/modules/acquisition/manifest-preview.js";
import type { DownloadContent } from "../../../src/modules/acquisition/sources/public.js";
import type {
	TorrentClient,
	TorrentConnection,
	TorrentManifest,
} from "../../../src/modules/acquisition/torrent-clients/public.js";
import {
	frierenSeasonPackFixture,
	loadReleaseCorpus,
} from "../../support/anime-release-corpus.js";

const frieren = frierenSeasonPackFixture(await loadReleaseCorpus());
const name = "Sousou no Frieren Season 2";
const paths = [
	"Season 2/01.mkv",
	"Season 2/03v1.mkv",
	"Season 2/03v2.mkv",
	"Season 2/03v2.zh.ass",
	"Season 2/NCOP.mkv",
	"Season 2/S02E04-E05.mkv",
	"Season 2/07.mkv",
	"Season 1/02.mkv",
	"Season 2/Other Anime - 06.mkv",
	"Season 2/Disc 1/00006.m2ts",
];
function torrentBytes(entries = paths) {
	return new Uint8Array(
		toTorrentFile({
			infoHash: "",
			announce: [],
			urlList: [],
			info: {
				name: Buffer.from(name),
				files: entries.map((path, index) => ({
					path: path.split("/").map((part) => Buffer.from(part)),
					length: 100 + index,
				})),
				"piece length": 16384,
				pieces: Buffer.alloc(20),
			},
		}),
	);
}
const bytes = { kind: "bytes", bytes: torrentBytes() } as const;
const { hash, localManifest } = await inspectTorrentContent(bytes, null);
const magnet = { kind: "magnet", uri: `magnet:?xt=urn:btih:${hash}` } as const;
const files = paths.map((path, index) => ({
	index,
	path: `${name}/${path}`,
	sizeBytes: 100 + index,
}));
const manifest = {
	hash,
	indexSource: "client",
	files,
} satisfies TorrentManifest;

function candidate(
	id: string,
	content: DownloadContent,
	{
		sourceId = id,
		expectedHash = hash,
	}: { sourceId?: string; expectedHash?: string | null } = {},
) {
	let current = true;
	const entry = {
		id,
		download: id,
		title: frieren.title,
		observationId: id,
		hash: expectedHash,
		publishedAt: null,
	};
	return {
		entry,
		publication: {
			snapshot: {
				id: sourceId,
				revision: "1",
				label: "source",
				entries: [entry],
				checkedAt: 0,
				nextAttemptAt: 0,
				error: null,
			},
			content: {
				readContent: vi.fn(async () => content),
				isContentCurrent: () => current,
			},
			commit: vi.fn(),
		},
		invalidate: () => {
			current = false;
		},
	};
}

function fixture(deadlineMs = 4_000) {
	const inspect = vi.fn<NonNullable<TorrentClient["inspectMetadata"]>>(
		async () => manifest,
	);
	const add = vi.fn();
	const logs: string[] = [];
	let generation = "initial";
	let now = 0;
	const connection: TorrentConnection = {
		connectionGeneration: () => generation,
		withClient: (_generation, operation) =>
			operation({ inspectMetadata: inspect, add } as unknown as TorrentClient),
	};
	const preview = new ManifestPreview(
		connection,
		frieren.mapReleaseFiles,
		pino({ level: "info" }, { write: (line) => logs.push(line) }),
		() => now,
		deadlineMs,
	);
	const request = (
		candidates: Parameters<ManifestPreview["preview"]>[0]["candidates"],
		scope: Parameters<ManifestPreview["preview"]>[0]["scope"] = {
			startEpisode: 1,
		},
	) =>
		preview.preview({
			candidates,
			workKey: "anilist:anime:182255",
			target: frieren.target,
			scope,
			signal: new AbortController().signal,
		});
	return {
		inspect,
		add,
		logs,
		request,
		changeConnection: () => {
			generation = "changed";
		},
		advance: () => {
			now += 31_000;
		},
	};
}

test("torrent bytes and magnet preview the same coverage, indices and sizes", async () => {
	const f = fixture();
	const [upload, link] = await f.request([
		candidate("bytes", bytes),
		candidate("magnet", magnet),
	]);
	expect(f.inspect.mock.calls.map(([input]) => input.source)).toEqual(
		expect.arrayContaining([{ magnet: magnet.uri }, { torrent: bytes.bytes }]),
	);
	expect(upload).toEqual(link);
	expect(upload).toMatchObject({
		manifest,
		coverage: {
			episodes: [1, 3, 4, 5, 7],
			complete: false,
			videos: [
				{ index: 0, episodes: [1], subtitleIndices: [] },
				{
					index: 1,
					episodes: [3],
					subtitleIndices: [],
					attributes: { revision: 1 },
				},
				{
					index: 2,
					episodes: [3],
					subtitleIndices: [3],
					attributes: { revision: 2 },
				},
				{ index: 5, episodes: [4, 5], subtitleIndices: [] },
				{ index: 6, episodes: [7], subtitleIndices: [] },
			],
		},
	});
	expect(
		await f.request([candidate("one", magnet)], { episode: 4 }),
	).toMatchObject([{ selectableEpisodes: [] }]);
	expect(
		await f.request([candidate("one", magnet)], { episode: 3 }),
	).toMatchObject([{ selectableEpisodes: [3] }]);
	expect(f.add).not.toHaveBeenCalled();
	expect(f.logs.join("")).not.toContain("magnet:");
});

test("an older client falls back to validated local metainfo for bytes only", async () => {
	const f = fixture();
	f.inspect.mockResolvedValue(null);
	const [upload, link] = await f.request([
		candidate("bytes", bytes),
		candidate("magnet", magnet),
	]);
	expect(upload).toMatchObject({
		manifest: { ...localManifest(), indexSource: "metainfo", files },
		coverage: { episodes: [1, 3, 4, 5, 7] },
	});
	expect(link).toEqual({ code: "metadata_unsupported" });
	expect(f.logs.join("")).toContain("metadata_unsupported");
});

test("metadata cache shares pending work and fences source, claimed hash, and connection", async () => {
	const f = fixture();
	let finish: (value: TorrentManifest) => void = () => {};
	f.inspect.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const item = candidate("magnet", magnet);
	const first = f.request([item]);
	const second = f.request([item]);
	await vi.waitFor(() => expect(f.inspect).toHaveBeenCalledTimes(1));
	finish(manifest);
	expect(await first).toEqual(await second);
	await f.request([candidate("bytes", bytes, { sourceId: "magnet" })]);
	expect(f.inspect).toHaveBeenCalledTimes(1);
	expect(
		await f.request([
			candidate("wrong", magnet, {
				sourceId: "magnet",
				expectedHash: "f".repeat(40),
			}),
		]),
	).toEqual([{ code: "torrent_identity_conflict" }]);
	item.invalidate();
	expect(await f.request([item])).toEqual([{ code: "source_changed" }]);
	f.changeConnection();
	await f.request([candidate("magnet", magnet)]);
	expect(f.inspect).toHaveBeenCalledTimes(2);
});

test("rejects unsafe paths, repeated indices and stale manifest hashes", async () => {
	const f = fixture();
	const first = { index: 0, path: "01.mkv", sizeBytes: 100 };
	f.inspect
		.mockResolvedValueOnce({
			...manifest,
			files: [{ ...first, path: "a/../escape.mkv" }],
		})
		.mockResolvedValueOnce({ ...manifest, files: [first, first] })
		.mockResolvedValueOnce({ ...manifest, hash: "f".repeat(40) });
	expect(await f.request([candidate("unsafe", magnet)])).toEqual([
		{ code: "invalid_file_path" },
	]);
	expect(await f.request([candidate("duplicate", magnet)])).toEqual([
		{ code: "invalid_torrent_manifest" },
	]);
	expect(await f.request([candidate("stale", magnet)])).toEqual([
		{ code: "torrent_identity_conflict" },
	]);
	expect(
		await f.request([
			candidate(
				"unsafe-bytes",
				{
					kind: "bytes",
					bytes: torrentBytes(["../escape.mkv"]),
				},
				{ expectedHash: null },
			),
		]),
	).toEqual([{ code: "invalid_file_path" }]);
	expect(f.inspect).toHaveBeenCalledTimes(3);
	expect(f.logs.join("")).toMatch(/invalid_file_path/);
	expect(f.logs.join("")).toMatch(/invalid_torrent_manifest/);
	expect(f.logs.join("")).toMatch(/torrent_identity_conflict/);
});

test("a timeout backs off that locator while later candidates can yield coverage", async () => {
	const f = fixture(60);
	f.inspect.mockImplementationOnce(async (_input, signal) => {
		await wait(1_000, undefined, { signal });
		return manifest;
	});
	const slow = candidate("slow", magnet);
	const [unavailable, next] = await f.request([
		slow,
		candidate("next", magnet),
	]);
	expect(unavailable).toEqual({ code: "metadata_timeout" });
	expect(next?.coverage?.episodes).toContain(3);
	await wait(10);
	expect(await f.request([slow])).toEqual([{ code: "metadata_timeout" }]);
	expect(f.inspect).toHaveBeenCalledTimes(2);
	f.advance();
	expect((await f.request([slow]))[0]?.coverage?.episodes).toContain(3);
	expect(f.logs.join("")).toContain("metadata_timeout");
});

test("a discovery pass limits candidate count and concurrent client lookups", async () => {
	const f = fixture();
	let running = 0;
	let peak = 0;
	f.inspect.mockImplementation(async () => {
		running++;
		peak = Math.max(peak, running);
		await wait(10);
		running--;
		return manifest;
	});
	const candidates = Array.from({ length: 6 }, (_, index) =>
		candidate(`source-${index}`, magnet),
	);
	const previews = await f.request(candidates);
	expect(previews).toHaveLength(4);
	expect(previews.every((preview) => preview.code === null)).toBe(true);
	expect(peak).toBe(2);
});

test("complete season requires distinct regular episodes and a known count", () => {
	const files = ["01", "02", "03"].map((number, index) => ({
		index,
		path: `Season 2/${number}.mkv`,
	}));
	const target = {
		...frieren.target,
		work: { ...frieren.target.work, episodeCount: 3 },
	};
	expect(frieren.mapReleaseFiles(frieren.title, target, files)).toMatchObject({
		episodes: [1, 2, 3],
		complete: true,
	});
	expect(
		frieren.mapReleaseFiles(
			frieren.title,
			{ ...target, work: { ...target.work, episodeCount: null } },
			files,
		),
	).toMatchObject({ episodes: [1, 2, 3], complete: false });
});
