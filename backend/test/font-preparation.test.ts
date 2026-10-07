import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type {
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../src/contracts/http.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { SubtitleFontPreparation } from "../src/modules/subtitles/application/font-preparation.js";
import { SubtitleApplication } from "../src/modules/subtitles/application/subtitles.js";
import { subtitlePolicy } from "../src/modules/subtitles/domain/policy.js";
import { validateFont } from "../src/modules/subtitles/infrastructure/fonts.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { settingsStore } from "./settings-store.js";

const ttf = await readFile(
	new URL("./fixtures/fonts/fixture.ttf", import.meta.url),
);
const otf = await readFile(
	new URL("./fixtures/fonts/fixture.otf", import.meta.url),
);
const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" };
const logger = pino({ level: "silent" });
let directory: string;
let dataDir: string;
let root: string;
let database: ApplicationDatabase;
let library: ReturnType<typeof createLibraryModule>;
let fonts: SubtitleFontPreparation;
let fileId: string;
let index: LibraryIndex;
const info = parseMediaInfo(
	JSON.stringify({
		format: {},
		streams: [
			{ index: 2, codec_type: "subtitle", codec_name: "ass" },
			{ index: 3, codec_type: "subtitle", codec_name: "ass" },
			{
				index: 4,
				codec_type: "attachment",
				codec_name: "ttf",
				tags: { filename: "../../evil.ttf", mimetype: "font/ttf" },
			},
			{
				index: 5,
				codec_type: "attachment",
				codec_name: "otf",
				tags: { filename: "other.otf" },
			},
			{
				index: 6,
				codec_type: "attachment",
				codec_name: "png",
				tags: { filename: "cover.png" },
			},
		],
	}),
);
const extract = vi.fn(async (_path: string, index: number) =>
	index === 4 ? ttf : otf,
);
const tools = {
	extractAttachment: extract,
	extractSubtitle: vi.fn(async (_path: string, index: number) => ({
		streamIndex: index,
		format: "ass" as const,
		text: "[Script Info]\nScriptType: v4.00+\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,你好 A",
	})),
};
function service(policy = subtitlePolicy) {
	return new SubtitleFontPreparation({
		dataDir,
		repository: database.subtitles,
		sources: library.sources,
		tools,
		policy,
	});
}
async function source() {
	return library.sources.resolveSource(fileId);
}
async function complete(id: string) {
	await vi.waitFor(async () =>
		expect((await fonts.status(id)).status).not.toBe("pending"),
	);
	return fonts.status(id);
}
beforeEach(async () => {
	extract
		.mockReset()
		.mockImplementation(async (_path, index) => (index === 4 ? ttf : otf));
	tools.extractSubtitle.mockClear();
	directory = await mkdtemp(join(tmpdir(), "anishelf-fonts-"));
	dataDir = join(directory, "data");
	root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mkv"), "video");
	database = ApplicationDatabase.open(dataDir);
	index = new LibraryIndex();
	library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger,
	});
	await library.startScan();
	await library.waitForCompletion();
	fileId =
		[...index.snapshot.entriesById.values()].find(
			(entry) => entry.kind === "file",
		)?.id ?? "";
	fonts = service();
});
afterEach(async () => {
	await fonts.close();
	database.close();
	await rm(directory, { recursive: true, force: true });
});

test("validates real TTF/OTF and rejects renamed or truncated non-font payloads", () => {
	expect(validateFont(ttf)).toEqual({
		format: "ttf",
		family: "Anishelf Fixture",
	});
	expect(validateFont(otf).format).toBe("otf");
	expect(() => validateFont(Buffer.from("fake.ttf"))).toThrow();
	expect(() => validateFont(ttf.subarray(0, 32))).toThrow();
});

test("deduplicates concurrent source requests, confines names and preserves cache across reopen", async () => {
	const resolved = await source();
	const [first, second] = await Promise.all([
		fonts.prepare(resolved, info),
		fonts.prepare(resolved, info),
	]);
	expect(first.id).toBe(second.id);
	const ready = await complete(first.id);
	expect(ready.status).toBe("ready");
	expect(ready.assets).toHaveLength(2);
	expect(extract).toHaveBeenCalledTimes(2);
	expect(await readdir(join(dataDir, "subtitle-fonts"))).toEqual(
		expect.arrayContaining(ready.assets.map((asset) => asset.id)),
	);
	expect(
		(await fonts.content(ready.id, ready.assets[0]?.id ?? "")).bytes,
	).toEqual(ttf);
	await fonts.close();
	database.close();
	database = ApplicationDatabase.open(dataDir);
	fonts = service();
	expect((await fonts.prepare(resolved, info)).status).toBe("ready");
	expect(extract).toHaveBeenCalledTimes(2);
});

test("retains valid fonts after a bad attachment and retries degraded sets", async () => {
	extract.mockImplementation(async (_path, index) =>
		index === 4 ? ttf : Buffer.from("invalid font"),
	);
	const pending = await fonts.prepare(await source(), info);
	const degraded = await complete(pending.id);
	expect(degraded.status).toBe("degraded");
	expect(degraded.assets).toHaveLength(1);
	expect(degraded.warnings).toContain("FONT_EXTRACTION_FAILED");
	extract.mockImplementation(async (_path, index) => (index === 4 ? ttf : otf));
	await fonts.prepare(await source(), info);
	expect((await complete(pending.id)).assets).toHaveLength(2);
});

test("enforces count, per-font, aggregate and cache budgets", async () => {
	await fonts.close();
	fonts = service({ ...subtitlePolicy, fontMaximumCount: 1 });
	let result = await fonts.prepare(await source(), info);
	expect((await complete(result.id)).warnings).toContain("FONT_LIMIT_EXCEEDED");
	await fonts.close();
	fonts = service({ ...subtitlePolicy, fontMaximumBytes: 10 });
	result = await fonts.prepare(await source(), info);
	expect((await complete(result.id)).assets).toHaveLength(0);
	await fonts.close();
	fonts = service({ ...subtitlePolicy, fontSetMaximumBytes: ttf.length });
	result = await fonts.prepare(await source(), info);
	expect((await complete(result.id)).warnings).toContain("FONT_LIMIT_EXCEEDED");
	await fonts.close();
	fonts = service({ ...subtitlePolicy, fontMaximumCacheBytes: 1 });
	result = await fonts.prepare(await source(), info);
	expect((await complete(result.id)).warnings).toContain("FONT_CACHE_FULL");
	expect(await readdir(join(dataDir, "subtitle-fonts"))).toEqual([]);
});

test("detects same-length font corruption, removes it and regenerates on retry", async () => {
	const pending = await fonts.prepare(await source(), info);
	const ready = await complete(pending.id);
	const first = ready.assets[0];
	if (!first) throw new Error("No font");
	await writeFile(
		join(dataDir, "subtitle-fonts", first.id),
		Buffer.alloc(first.sizeBytes),
	);
	expect((await fonts.status(ready.id)).warnings).toContain(
		"FONT_CACHE_INVALID",
	);
	await expect(fonts.content(ready.id, first.id)).rejects.toMatchObject({
		code: "RESOURCE_NOT_FOUND",
	});
	await fonts.prepare(await source(), info);
	expect((await complete(ready.id)).status).toBe("ready");
});

test("source changes prevent publication and delivery", async () => {
	let release: (() => void) | undefined;
	extract.mockImplementation(async () => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return ttf;
	});
	const pending = await fonts.prepare(await source(), {
		...info,
		streams: info.streams.filter((stream) => stream.index === 4),
	});
	await vi.waitFor(() => expect(release).toBeDefined());
	await writeFile(join(root, "episode.mkv"), "changed video source");
	release?.();
	await vi.waitFor(() =>
		expect(database.subtitles.getFonts(pending.id)?.status).toBe("degraded"),
	);
	expect(await readdir(join(dataDir, "subtitle-fonts"))).toEqual([]);
	await expect(fonts.status(pending.id)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
});

test("startup reconciles interrupted records and orphan temporary files", async () => {
	const resolved = await source();
	await fonts.initialize();
	await writeFile(join(dataDir, "subtitle-fonts", "orphan.pending"), "partial");
	database.subtitles.saveFonts({
		id: "interrupted",
		source: resolved.identity,
		status: "pending",
		assets: [],
		warnings: [],
	});
	await fonts.close();
	fonts = service();
	await fonts.initialize();
	expect((await fonts.status("interrupted")).warnings).toContain(
		"FONT_INTERRUPTED",
	);
	expect(await readdir(join(dataDir, "subtitle-fonts"))).toEqual([]);
});

test("ASS selection returns font URLs, shares fonts across embedded/external tracks and does not extract on discovery", async () => {
	await writeFile(
		join(root, "episode.ass"),
		"[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,你好 A",
	);
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe: async () => info },
	});
	const subtitles = new SubtitleApplication({
		sources: library.sources,
		inspection,
		tools,
		dataDir,
		repository: database.subtitles,
	});
	const app = createHttpApp({
		library,
		subtitles,
		logger,
		config: { host: "127.0.0.1", port: 3000 },
	});
	try {
		const discovery = (
			await app.inject({ url: `/api/files/${fileId}/subtitles`, headers })
		).json<SubtitleDiscoveryResponse>();
		expect(extract).not.toHaveBeenCalled();
		const preparations: SubtitlePreparationResponse[] = [];
		for (const track of discovery.tracks) {
			const response = await app.inject({
				method: "POST",
				url: `/api/files/${fileId}/subtitles/${track.id}/prepare`,
				headers,
				payload: {
					sourceVersion: discovery.sourceVersion,
					...(track.origin === "external"
						? { subtitleVersion: track.sourceVersion }
						: {}),
				},
			});
			expect([200, 202]).toContain(response.statusCode);
			const preparation = response.json<SubtitlePreparationResponse>();
			preparations.push(preparation);
			if (preparation.status === "pending" && preparation.statusUrl) {
				await vi.waitFor(async () =>
					expect(
						(
							await app.inject({
								url: preparation.statusUrl as string,
								headers,
							})
						).json().status,
					).toBe("ready"),
				);
			}
		}
		expect(new Set(preparations.map((result) => result.fonts?.id)).size).toBe(
			1,
		);
		const url = preparations[0]?.fonts?.statusUrl;
		if (!url) throw new Error("Missing font status");
		await vi.waitFor(async () =>
			expect((await app.inject({ url, headers })).json().status).toBe("ready"),
		);
		const ready = (await app.inject({ url, headers })).json<
			NonNullable<SubtitlePreparationResponse["fonts"]>
		>();
		const fontUrl = ready.assets[0]?.contentUrl;
		if (!fontUrl) throw new Error("Missing font URL");
		const delivered = await app.inject({ url: fontUrl, headers });
		expect(delivered.headers["content-type"]).toBe("font/ttf");
		expect(delivered.rawPayload).toEqual(ttf);
		expect(delivered.headers["cache-control"]).toBe("no-store");
		expect(extract).toHaveBeenCalledTimes(2);
	} finally {
		await app.close();
		await inspection.close();
	}
});

test("concurrent retries after cached-font corruption launch one shared extraction", async () => {
	const resolved = await source();
	const pending = await fonts.prepare(resolved, info);
	const ready = await complete(pending.id);
	const asset = ready.assets[0];
	if (!asset) throw new Error("No font");
	await writeFile(
		join(dataDir, "subtitle-fonts", asset.id),
		Buffer.alloc(asset.sizeBytes),
	);
	extract.mockClear();
	await Promise.all([
		fonts.prepare(resolved, info),
		fonts.prepare(resolved, info),
	]);
	expect((await complete(pending.id)).status).toBe("ready");
	expect(extract).toHaveBeenCalledTimes(2);
});

test("no recognized attachments produces an empty ready set without extraction", async () => {
	const pending = await fonts.prepare(await source(), {
		...info,
		streams: info.streams.filter((stream) => stream.index === 6),
	});
	expect(await complete(pending.id)).toMatchObject({
		status: "ready",
		assets: [],
		warnings: [],
	});
	expect(extract).not.toHaveBeenCalled();
});

test("serializes publication budgets across concurrent source sets", async () => {
	await fonts.close();
	await writeFile(join(root, "second.mkv"), "second video");
	await library.startScan();
	await library.waitForCompletion();
	const secondId = [...index.snapshot.entriesById.values()].find(
		(entry) => entry.name === "second.mkv",
	)?.id;
	if (!secondId) throw new Error("Missing second source");
	let entered = 0;
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	extract.mockImplementation(async (_path, streamIndex) => {
		if (streamIndex === 4 && ++entered === 2) release?.();
		await gate;
		return streamIndex === 4 ? ttf : otf;
	});
	fonts = service({
		...subtitlePolicy,
		fontExtractionConcurrency: 2,
		fontMaximumCacheBytes: ttf.length + otf.length,
	});
	const first = await fonts.prepare(await source(), info);
	const second = await fonts.prepare(
		await library.sources.resolveSource(secondId),
		info,
	);
	const results = await Promise.all([complete(first.id), complete(second.id)]);
	expect(results.filter((set) => set.status === "ready")).toHaveLength(1);
	expect(
		results.filter((set) => set.warnings.includes("FONT_CACHE_FULL")),
	).toHaveLength(1);
	expect(
		results
			.flatMap((set) => set.assets)
			.reduce((total, asset) => total + asset.sizeBytes, 0),
	).toBe(ttf.length + otf.length);
});

test("shutdown aborts extraction and persists a retryable terminal state", async () => {
	await fonts.close();
	let started = false;
	fonts = new SubtitleFontPreparation({
		dataDir,
		repository: database.subtitles,
		sources: library.sources,
		policy: subtitlePolicy,
		tools: {
			extractSubtitle: tools.extractSubtitle,
			extractAttachment: async (_path, _index, options) => {
				started = true;
				return new Promise<Buffer>((_resolve, reject) =>
					options.signal?.addEventListener(
						"abort",
						() => reject(options.signal?.reason),
						{ once: true },
					),
				);
			},
		},
	});
	const pending = await fonts.prepare(await source(), info);
	await vi.waitFor(() => expect(started).toBe(true));
	await fonts.close();
	expect(await fonts.status(pending.id)).toMatchObject({
		status: "degraded",
		warnings: ["FONT_INTERRUPTED"],
		assets: [],
	});
	expect(await readdir(join(dataDir, "subtitle-fonts"))).toEqual([]);
});
