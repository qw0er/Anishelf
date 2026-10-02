import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import { DomainError } from "../src/errors.js";
import { createHttpApp } from "../src/http/app.js";
import type { SubtitleDiscoveryResponse } from "../src/http/contracts.js";
import { LibraryIndex } from "../src/library/index.js";
import { ResourceAccess } from "../src/resources/access.js";
import { maximumSubtitleBytes } from "../src/subtitles/model.js";
import { settingsStore } from "./settings-store.js";

let fixture: string;
let root: string;
let library: LibraryApplication;
let app: ReturnType<typeof createHttpApp>;
let fileId: string;
const video = "第 01 集 & 100%";
const headers = { host: "127.0.0.1:3000" };
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-subtitles-"));
	root = join(fixture, "media");
	await mkdir(join(root, "season"), { recursive: true });
	await writeFile(join(root, "season", `${video}.mkv`), "video");
	const logger = pino({ enabled: false });
	const index = new LibraryIndex();
	library = new LibraryApplication({
		index,
		configuration: settingsStore(root),
		logger,
	});
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
	});
	await library.startScan();
	await library.waitForCompletion();
	fileId =
		[...index.snapshot.entriesById.values()].find(
			(entry) => entry.kind === "file",
		)?.id ?? "";
});
afterEach(async () => {
	vi.restoreAllMocks();
	await app.close();
	await rm(fixture, { recursive: true, force: true });
});
async function discover(): Promise<SubtitleDiscoveryResponse> {
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles`,
		headers,
	});
	expect(response.statusCode).toBe(200);
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.body).not.toContain(fixture);
	expect(response.body).not.toContain("relativePath");
	return response.json();
}
async function sidecar(suffix: string, text = "subtitle") {
	await writeFile(join(root, "season", `${video}${suffix}`), text);
}

test("discovers exact stems, dot suffixes and all formats with deterministic ordering", async () => {
	for (const suffix of [
		".track10.ssa",
		".track2.ass",
		".zh-Hans.ASS",
		".en.forced.VTT",
		".srt",
		"0.srt",
		"-extra.ass",
		".txt",
		"..srt",
		".en..srt",
	])
		await sidecar(suffix);
	await writeFile(join(root, `${video}.vtt`), "wrong directory");
	await mkdir(join(root, "season", `${video}.folder.srt`));
	await mkdir(join(root, "season", "nested"));
	await writeFile(join(root, "season", "nested", `${video}.srt`), "nested");
	const result = await discover();
	expect(result.tracks.map((track) => track.name)).toEqual(
		[
			".en.forced.VTT",
			".srt",
			".track2.ass",
			".track10.ssa",
			".zh-Hans.ASS",
		].map((suffix) => `${video}${suffix}`),
	);
	expect(result.tracks.find((track) => track.format === "vtt")).toMatchObject({
		language: "en",
		label: "en.forced",
	});
	expect(
		result.tracks.find((track) => track.name.endsWith("zh-Hans.ASS")),
	).toMatchObject({ language: "zh-Hans", format: "ass" });
	expect(result.tracks.find((track) => track.format === "srt")).toMatchObject({
		language: null,
		label: null,
	});
	expect(
		result.tracks.find((track) => track.format === "ssa")?.language,
	).toBeNull();
	expect(result.warnings).toEqual([]);
	expect(new Set(result.tracks.map((track) => track.id)).size).toBe(5);
	expect(await discover()).toEqual(result);
	const directories = library.getDirectory(
		library.getDirectory("root").children[0]?.id ?? "",
	);
	expect(directories.children.map((entry) => entry.name)).toEqual([
		`${video}.mkv`,
	]);
});

test("reflects additions, modifications and removals without rescanning or changing originals", async () => {
	expect((await discover()).tracks).toEqual([]);
	await sidecar(".srt", "original");
	const first = (await discover()).tracks[0];
	await sidecar(".srt", "replacement content");
	const updated = (await discover()).tracks[0];
	expect(updated?.id).toBe(first?.id);
	expect(updated?.sourceVersion).not.toBe(first?.sourceVersion);
	expect(updated?.sizeBytes).toBe(19);
	await rm(join(root, "season", `${video}.srt`));
	expect((await discover()).tracks).toEqual([]);
});

test("rejects symlinks and oversized files while keeping usable candidates", async () => {
	await sidecar(".srt");
	await sidecar(".large.ass", "");
	await truncate(
		join(root, "season", `${video}.large.ass`),
		maximumSubtitleBytes + 1,
	);
	await writeFile(join(fixture, "outside.ass"), "secret");
	await symlink(
		join(fixture, "outside.ass"),
		join(root, "season", `${video}.outside.ass`),
	);
	const result = await discover();
	expect(result.tracks.map((track) => track.name)).toEqual([`${video}.srt`]);
	expect(result.warnings).toEqual([
		{ name: `${video}.large.ass`, code: "SUBTITLE_TOO_LARGE" },
		{ name: `${video}.outside.ass`, code: "RESOURCE_ACCESS_DENIED" },
	]);
	const media = await app.inject({ url: `/api/media/${fileId}`, headers });
	expect(media.statusCode).toBe(200);
	expect(media.body).toBe("video");
	const resources = await ResourceAccess.create({ resourceRoot: root });
	await expect(
		resources.openFile(join("season", `${video}.srt`)),
	).rejects.toMatchObject({ code: "RESOURCE_ACCESS_DENIED" });
});

test.each(["RESOURCE_UNREADABLE", "RESOURCE_MISSING"] as const)(
	"returns safe per-file warnings for %s",
	async (code) => {
		await sidecar(".srt");
		vi.spyOn(
			ResourceAccess.prototype,
			"inspectSubtitleSource",
		).mockRejectedValue(new DomainError(code, `secret ${fixture}`));
		expect(await discover()).toMatchObject({
			tracks: [],
			warnings: [{ name: `${video}.srt`, code }],
		});
	},
);

test("rejects a video replaced during discovery", async () => {
	const read = ResourceAccess.prototype.readDirectory;
	vi.spyOn(ResourceAccess.prototype, "readDirectory").mockImplementation(
		async function (this: ResourceAccess, path) {
			const entries = await read.call(this, path);
			await writeFile(join(root, "season", `${video}.mkv`), "changed video");
			return entries;
		},
	);
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles`,
		headers,
	});
	expect(response.statusCode).toBe(409);
	expect(response.json().error.code).toBe("PLAYBACK_CONFLICT");
});

test("rejects a root switch while discovery is in flight", async () => {
	const read = ResourceAccess.prototype.readDirectory;
	let release: () => void = () => {};
	let entered: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	vi.spyOn(ResourceAccess.prototype, "readDirectory").mockImplementationOnce(
		async function (this: ResourceAccess, path) {
			const entries = await read.call(this, path);
			entered();
			await gate;
			return entries;
		},
	);
	const request = app
		.inject({ url: `/api/files/${fileId}/subtitles`, headers })
		.then((response) => response);
	await started;
	try {
		const other = join(fixture, "other");
		await mkdir(other);
		await library.updateSettings({ resourceRoot: other });
	} finally {
		release();
	}
	const response = await request;
	expect(response.statusCode).toBe(409);
	await library.waitForCompletion();
});

test("rejects invalid IDs, unknown files, directory IDs and missing videos", async () => {
	for (const [id, status] of [
		["%2Fprivate", 400],
		["unknown", 404],
		["root", 404],
	] as const) {
		const response = await app.inject({
			url: `/api/files/${id}/subtitles`,
			headers,
		});
		expect(response.statusCode).toBe(status);
	}
	await rm(join(root, "season", `${video}.mkv`));
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles`,
		headers,
	});
	expect(response.statusCode).toBe(404);
});

async function contentUrl() {
	const discovered = await discover();
	const track = discovered.tracks[0];
	if (!track) throw new Error("Missing test subtitle");
	return `/api/files/${fileId}/subtitles/${track.id}/content?${new URLSearchParams({ sourceVersion: discovered.sourceVersion, subtitleVersion: track.sourceVersion })}`;
}

test("serves bounded UTF-8 subtitle text without exposing paths", async () => {
	await sidecar(".srt", "1\n00:00:01,000 --> 00:00:02,000\n你好\n");
	const response = await app.inject({ url: await contentUrl(), headers });
	expect(response.statusCode).toBe(200);
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.body).toContain("你好");
	expect(response.body).not.toContain(fixture);
});

test("decodes UTF-16 BOMs and rejects undecodable bytes", async () => {
	await writeFile(
		join(root, "season", `${video}.srt`),
		Buffer.concat([
			Buffer.from([0xff, 0xfe]),
			Buffer.from("hello 你好", "utf16le"),
		]),
	);
	expect((await app.inject({ url: await contentUrl(), headers })).body).toBe(
		"hello 你好",
	);
	const bigEndian = Buffer.concat([
		Buffer.from([0xfe, 0xff]),
		Buffer.from("hello 你好", "utf16le").swap16(),
	]);
	await writeFile(join(root, "season", `${video}.srt`), bigEndian);
	expect((await app.inject({ url: await contentUrl(), headers })).body).toBe(
		"hello 你好",
	);
	await writeFile(
		join(root, "season", `${video}.srt`),
		Buffer.from([0xff, 0xff, 0xff]),
	);
	const response = await app.inject({ url: await contentUrl(), headers });
	expect(response.statusCode).toBe(422);
	expect(response.json().error.code).toBe("SUBTITLE_INVALID_ENCODING");
});

test("rejects stale subtitle and video versions and removed tracks", async () => {
	await sidecar(".srt");
	const original = await contentUrl();
	await sidecar(".srt", "changed subtitle");
	expect((await app.inject({ url: original, headers })).statusCode).toBe(409);
	const current = await contentUrl();
	await writeFile(join(root, "season", `${video}.mkv`), "changed video");
	expect((await app.inject({ url: current, headers })).statusCode).toBe(409);
	const latest = await contentUrl();
	await rm(join(root, "season", `${video}.srt`));
	expect((await app.inject({ url: latest, headers })).statusCode).toBe(404);
});

test("never accepts paths, unversioned requests or foreign subtitle IDs", async () => {
	await sidecar(".srt");
	const url = await contentUrl();
	const trackId = /\/subtitles\/([^/?]+)/.exec(url)?.[1] ?? "";
	for (const invalid of [
		url.replace(trackId, "%2Fetc%2Fpasswd"),
		url.split("?")[0] ?? "",
		`${url}&path=/etc/passwd`,
	]) {
		expect((await app.inject({ url: invalid, headers })).statusCode).toBe(400);
	}
	expect(
		(await app.inject({ url: url.replace(trackId, "unknown"), headers }))
			.statusCode,
	).toBe(404);
});
