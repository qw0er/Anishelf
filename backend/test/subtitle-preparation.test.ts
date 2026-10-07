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
import {
	type BuiltinPolicy,
	builtinPolicy,
} from "../src/modules/configuration/policy.js";
import type { LibraryApplication } from "../src/modules/library/application/library.js";
import { createResourceId } from "../src/modules/library/domain/model.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { SubtitleApplication } from "../src/modules/subtitles/application/subtitles.js";
import {
	type MediaInfo,
	type MediaStream,
	MediaToolError,
	MediaTools,
} from "../src/platform/media/index.js";
import { runTool } from "../src/platform/media/process.js";
import { settingsStore } from "./settings-store.js";

let directory: string;
let root: string;
let dataDir: string;
let database: ApplicationDatabase;
let library: LibraryApplication;
let subtitles: SubtitleApplication;
let app: ReturnType<typeof createHttpApp>;
let fileId: string;
let extract: ReturnType<typeof vi.fn<MediaTools["extractSubtitle"]>>;
let policy: BuiltinPolicy;
let probe: ReturnType<typeof vi.fn<MediaTools["probe"]>>;
const logRecords: Record<string, unknown>[] = [];
const logger = pino(
	{ level: "trace" },
	{ write: (line: string) => logRecords.push(JSON.parse(line)) },
);
const headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" };
const text = "1\n00:00:00,200 --> 00:00:01,200\n你好字幕\n";
const stream: MediaStream = {
	index: 2,
	type: "subtitle",
	codec: "subrip",
	profile: null,
	width: null,
	height: null,
	pixelFormat: null,
	frameRate: null,
	framesPerSecond: null,
	level: null,
	bitDepth: null,
	colorRange: null,
	colorSpace: null,
	colorTransfer: null,
	colorPrimaries: null,
	hdr: { pq: false, hlg: false, sideDataTypes: [], sideData: [] },
	attachedPicture: false,
	sampleRate: null,
	channels: null,
	channelLayout: null,
	duration: null,
	bitRate: null,
	tags: {},
	default: true,
	forced: false,
};
const info: MediaInfo = {
	format: "matroska",
	formatAliases: ["matroska"],
	container: "matroska",
	duration: 2,
	size: null,
	bitRate: null,
	tags: {},
	streams: [stream],
	chapters: [],
};
function server() {
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe },
		policy: policy.mediaInspection,
		logger,
	});
	subtitles = new SubtitleApplication({
		logger,
		sources: library.sources,
		policy,
		inspection,
		tools: { extractSubtitle: extract },
		dataDir,
		repository: database.subtitles,
	});
	app = createHttpApp({
		library,
		subtitles,
		logger,
		config: { host: "127.0.0.1", port: 3000 },
	});
	app.addHook("onClose", async () => inspection.close());
}
beforeEach(async () => {
	logRecords.length = 0;
	directory = await mkdtemp(join(tmpdir(), "anishelf-subtitle-preparation-"));
	root = join(directory, "media");
	dataDir = join(directory, "data");
	await mkdir(root);
	await writeFile(join(root, "episode.mkv"), "original video");
	policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	database = ApplicationDatabase.open(dataDir);
	const index = new LibraryIndex();
	library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		policy,
		logger,
	});
	await library.startScan();
	await library.waitForCompletion();
	fileId =
		[...index.snapshot.entriesById.values()].find(
			(entry) => entry.kind === "file",
		)?.id ?? "";
	probe = vi.fn<MediaTools["probe"]>().mockResolvedValue(info);
	extract = vi
		.fn<MediaTools["extractSubtitle"]>()
		.mockResolvedValue({ streamIndex: 2, format: "srt", text });
	server();
});
afterEach(async () => {
	await app.close();
	database.close();
	await rm(directory, { recursive: true, force: true });
});
async function discover(): Promise<SubtitleDiscoveryResponse> {
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles`,
		headers,
	});
	expect(response.statusCode).toBe(200);
	return response.json();
}
async function prepare(discovery?: SubtitleDiscoveryResponse) {
	const tracks = discovery ?? (await discover());
	return app.inject({
		method: "POST",
		url: `/api/files/${fileId}/subtitles/${tracks.tracks[0]?.id}/prepare`,
		headers,
		payload: { sourceVersion: tracks.sourceVersion },
	});
}
async function terminal(id: string): Promise<SubtitlePreparationResponse> {
	let result!: SubtitlePreparationResponse;
	await vi.waitFor(async () => {
		const response = await app.inject({
			url: `/api/subtitle-assets/${id}/status`,
			headers,
		});
		expect(response.statusCode).toBe(200);
		result = response.json();
		expect(result.status).not.toBe("pending");
	});
	return result;
}

test("extracts only selected tracks, publishes complete UTF-8 text and reuses it after restart", async () => {
	const discovery = await discover();
	expect(extract).not.toHaveBeenCalled();
	const response = await prepare(discovery);
	expect(response.statusCode).toBe(202);
	const pending = response.json<SubtitlePreparationResponse>();
	expect(pending.contentUrl).toBeNull();
	const result = await terminal(pending.id);
	expect(result.status).toBe("ready");
	const content = await app.inject({ url: result.contentUrl ?? "", headers });
	expect(content.statusCode).toBe(200);
	expect(content.body).toBe(text);
	expect(content.headers["x-content-type-options"]).toBe("nosniff");
	expect(await readFile(join(root, "episode.mkv"), "utf8")).toBe(
		"original video",
	);
	expect(JSON.stringify(result)).not.toContain(directory);
	const registered = database.playback.registerSource(
		(await library.sources.resolveSource(fileId)).identity,
	);
	expect(database.playback.get(registered.id)).toBeUndefined();
	await app.close();
	database.close();
	database = ApplicationDatabase.open(dataDir);
	// Reopen the same source with a fresh library and a fresh application.
	library = createLibraryModule({
		index: new LibraryIndex(),
		configuration: settingsStore(root),
		logger,
	});
	await library.startScan();
	await library.waitForCompletion();
	server();
	const reused = await prepare();
	expect(reused.statusCode).toBe(200);
	expect(reused.json().id).toBe(result.id);
	expect(extract).toHaveBeenCalledTimes(1);
});

test("deduplicates selected concurrent requests and hides pending assets", async () => {
	let complete!: (
		result: Awaited<ReturnType<MediaTools["extractSubtitle"]>>,
	) => void;
	extract.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const discovery = await discover();
	const first = await prepare(discovery);
	await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
	const second = await prepare(discovery);
	expect(second.json().id).toBe(first.json().id);
	expect(extract).toHaveBeenCalledTimes(1);
	const content = await app.inject({
		url: `/api/subtitle-assets/${first.json().id}`,
		headers,
	});
	expect(content.statusCode).toBe(404);
	complete({ streamIndex: 2, format: "srt", text });
	expect((await terminal(first.json().id)).status).toBe("ready");
});

test("safe failures can be retried without publishing partial files", async () => {
	extract.mockRejectedValueOnce(
		new MediaToolError("TOOL_FAILED", `private ${directory}`),
	);
	const first = await prepare();
	const failed = await terminal(first.json().id);
	expect(failed).toMatchObject({
		status: "failed",
		errorCode: "SUBTITLE_EXTRACTION_FAILED",
		contentUrl: null,
	});
	expect(JSON.stringify(failed)).not.toContain(directory);
	expect(logRecords).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "subtitles.preparation_started",
				level: 30,
			}),
			expect.objectContaining({
				event: "subtitles.preparation_failed",
				level: 50,
				assetId: failed.id,
				errorCode: "SUBTITLE_EXTRACTION_FAILED",
				err: expect.any(Object),
			}),
		]),
	);
	expect(await readdir(join(dataDir, "cache", "subtitles"))).toEqual([]);
	const retry = await prepare();
	expect(retry.json().id).toBe(failed.id);
	expect((await terminal(failed.id)).status).toBe("ready");
	expect(extract).toHaveBeenCalledTimes(2);
});

test("source replacement during extraction fails and removes the output", async () => {
	extract.mockImplementationOnce(async () => {
		await writeFile(join(root, "episode.mkv"), "new source");
		return { streamIndex: 2, format: "srt", text };
	});
	const response = await prepare();
	const id = response.json().id;
	await vi.waitFor(() =>
		expect(database.subtitles.get(id)?.status).toBe("failed"),
	);
	expect(database.subtitles.get(id)?.errorCode).toBe("PLAYBACK_CONFLICT");
	expect(
		(await app.inject({ url: `/api/subtitle-assets/${id}`, headers }))
			.statusCode,
	).toBe(409);
	expect(await readdir(join(dataDir, "cache", "subtitles"))).toEqual([]);
});

test("rejects stale versions, unknown tracks, client selectors and bitmap tracks", async () => {
	const discovery = await discover();
	const url = `/api/files/${fileId}/subtitles/${discovery.tracks[0]?.id}/prepare`;
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: { sourceVersion: "stale" },
			})
		).statusCode,
	).toBe(409);
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: { sourceVersion: discovery.sourceVersion, streamIndex: 2 },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await app.inject({
				method: "POST",
				url: `/api/files/${fileId}/subtitles/unknown/prepare`,
				headers,
				payload: { sourceVersion: discovery.sourceVersion },
			})
		).statusCode,
	).toBe(404);
	probe.mockResolvedValue({
		...info,
		streams: [{ ...stream, codec: "hdmv_pgs_subtitle" }],
	});
	await subtitles.close();
	server();
	expect((await prepare()).statusCode).toBe(422);
	expect(extract).not.toHaveBeenCalled();
});

test("missing ready files invalidate the asset and preparation rebuilds it", async () => {
	const first = await prepare();
	const ready = await terminal(first.json().id);
	await rm(join(dataDir, "cache", "subtitles", `${ready.id}.srt`));
	expect((await terminal(ready.id)).status).toBe("failed");
	await prepare();
	expect((await terminal(ready.id)).status).toBe("ready");
	expect(extract).toHaveBeenCalledTimes(2);
});

test("startup removes orphans and fails interrupted jobs without altering durable history", async () => {
	const response = await prepare();
	await terminal(response.json().id);
	const asset = database.subtitles.get(response.json().id);
	if (!asset) throw new Error("Missing asset");
	database.subtitles.save({ ...asset, status: "pending", sizeBytes: null });
	await writeFile(
		join(dataDir, "cache", "subtitles", "orphan.pending"),
		"incomplete",
	);
	await subtitles.close();
	server();
	await subtitles.initialize();
	expect(database.subtitles.get(asset.id)).toMatchObject({
		status: "failed",
		errorCode: "SUBTITLE_INTERRUPTED",
	});
	expect(await readdir(join(dataDir, "cache", "subtitles"))).toEqual([]);
});

test("prepares a real MKV subtitle through HTTP without changing the original", async () => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available || !tools.status.ffprobe.available)
		throw new Error("FFmpeg/FFprobe unavailable");
	const sidecar = join(directory, "source.srt");
	await writeFile(sidecar, text);
	const path = join(root, "episode.mkv");
	await runTool(tools.status.ffmpeg.path, [
		"-nostdin",
		"-v",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=size=32x32:rate=1:duration=2",
		"-i",
		sidecar,
		"-map",
		"0:v",
		"-map",
		"1:s",
		"-c:v",
		"ffv1",
		"-c:s",
		"copy",
		path,
	]);
	const original = await readFile(path);
	probe.mockImplementation((path, signal) => tools.probe(path, signal));
	extract.mockImplementation((path, index, options) =>
		tools.extractSubtitle(path, index, options),
	);
	const response = await prepare();
	const ready = await terminal(response.json().id);
	expect(ready.status).toBe("ready");
	const content = await app.inject({ url: ready.contentUrl ?? "", headers });
	expect(content.body).toContain("你好字幕");
	expect(await readFile(path)).toEqual(original);
});

test.each(["size", "budget"] as const)(
	"bounds subtitle %s and leaves no files on failure",
	async (kind) => {
		if (kind === "size") policy.subtitles.maximumBytes = 5;
		else policy.subtitles.maximumCacheBytes = 5;
		const response = await prepare();
		const result = await terminal(response.json().id);
		expect(result).toMatchObject({
			status: "failed",
			errorCode: kind === "size" ? "SUBTITLE_TOO_LARGE" : "SUBTITLE_CACHE_FULL",
		});
		expect(await readdir(join(dataDir, "cache", "subtitles"))).toEqual([]);
	},
);

test("another track receives busy feedback until the active extraction finishes", async () => {
	probe.mockResolvedValue({
		...info,
		streams: [stream, { ...stream, index: 3 }],
	});
	let complete!: (
		result: Awaited<ReturnType<MediaTools["extractSubtitle"]>>,
	) => void;
	extract.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const discovery = await discover();
	const first = await prepare(discovery);
	await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
	const response = await app.inject({
		method: "POST",
		url: `/api/files/${fileId}/subtitles/${discovery.tracks[1]?.id}/prepare`,
		headers,
		payload: { sourceVersion: discovery.sourceVersion },
	});
	expect(response.statusCode).toBe(503);
	expect(response.json().error.code).toBe("SUBTITLE_PREPARATION_BUSY");
	complete({ streamIndex: 2, format: "srt", text });
	await terminal(first.json().id);
});

test("shutdown aborts extraction and records interrupted rather than ready", async () => {
	extract.mockImplementationOnce(
		(_path, _stream, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new Error("aborted")),
					{ once: true },
				);
			}),
	);
	const response = await prepare();
	await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
	await subtitles.close();
	expect(database.subtitles.get(response.json().id)).toMatchObject({
		status: "failed",
		errorCode: "SUBTITLE_INTERRUPTED",
	});
	expect(await readdir(join(dataDir, "cache", "subtitles"))).toEqual([]);
});

test("changing roots during extraction invalidates the old task", async () => {
	extract.mockImplementationOnce(async () => {
		const other = join(directory, "other");
		await mkdir(other);
		await writeFile(join(other, "episode.mkv"), "other video");
		await library.updateSettings({ resourceRoot: other });
		return { streamIndex: 2, format: "srt", text };
	});
	const response = await prepare();
	const id = response.json().id;
	await vi.waitFor(() =>
		expect(database.subtitles.get(id)?.status).toBe("failed"),
	);
	expect(database.subtitles.get(id)?.errorCode).toBe("PLAYBACK_CONFLICT");
});

test("parallel extractions respect injected slots and the combined cache budget", async () => {
	policy.subtitles.extractionConcurrency = 2;
	policy.subtitles.maximumCacheBytes = Buffer.byteLength(text);
	probe.mockResolvedValue({
		...info,
		streams: [stream, { ...stream, index: 3 }, { ...stream, index: 4 }],
	});
	const complete: (() => void)[] = [];
	extract.mockImplementation(
		(_path, index) =>
			new Promise((resolve) => {
				complete.push(() =>
					resolve({ streamIndex: index, format: "srt", text }),
				);
			}),
	);
	const discovery = await discover();
	const first = await prepare(discovery);
	const requestTrack = (index: number) =>
		app.inject({
			method: "POST",
			headers,
			url: `/api/files/${fileId}/subtitles/${discovery.tracks[index]?.id}/prepare`,
			payload: { sourceVersion: discovery.sourceVersion },
		});
	const second = await requestTrack(1);
	expect(first.statusCode).toBe(202);
	expect(second.statusCode).toBe(202);
	await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
	expect((await prepare(discovery)).json().id).toBe(first.json().id);
	expect((await requestTrack(2)).json().error.code).toBe(
		"SUBTITLE_PREPARATION_BUSY",
	);
	for (const finish of complete) finish();
	const results = await Promise.all([
		terminal(first.json().id),
		terminal(second.json().id),
	]);
	expect(results.filter((result) => result.status === "ready")).toHaveLength(1);
	expect(
		results.filter((result) => result.errorCode === "SUBTITLE_CACHE_FULL"),
	).toHaveLength(1);
});
test("default extraction format controls text codecs without a native format", async () => {
	policy.subtitles.defaultExtractionFormat = "ass";
	probe.mockResolvedValue({
		...info,
		streams: [{ ...stream, codec: "mov_text" }],
	});
	extract.mockResolvedValue({ streamIndex: 2, format: "ass", text });
	const discovery = await discover();
	expect(discovery.tracks[0]?.format).toBe("ass");
	const response = await prepare(discovery);
	await terminal(response.json().id);
	expect(extract).toHaveBeenCalledWith(
		expect.any(String),
		2,
		expect.objectContaining({ format: "ass" }),
	);
});

test("probe slots deduplicate a source, reject excess work and become reusable", async () => {
	policy.mediaInspection.probeConcurrency = 2;
	await writeFile(join(root, "second.mkv"), "second");
	await writeFile(join(root, "third.mkv"), "third");
	await library.startScan();
	await library.waitForCompletion();
	const complete: (() => void)[] = [];
	probe.mockImplementation(
		() =>
			new Promise((resolve) => {
				complete.push(() => resolve(info));
			}),
	);
	const request = (id: string) =>
		app.inject({ headers, url: `/api/files/${id}/subtitles` });
	const first = request(fileId);
	const second = request(createResourceId("file", "second.mkv"));
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
	const duplicate = request(fileId);
	const busy = await request(createResourceId("file", "third.mkv"));
	expect(busy.json().warnings).toContainEqual(
		expect.objectContaining({ code: "SUBTITLE_PROBE_BUSY" }),
	);
	expect(probe).toHaveBeenCalledTimes(2);
	for (const finish of complete) finish();
	expect(
		(await Promise.all([first, second, duplicate])).map(
			(result) => result.statusCode,
		),
	).toEqual([200, 200, 200]);
	probe.mockResolvedValue(info);
	expect(
		(await request(createResourceId("file", "third.mkv"))).json().warnings,
	).toEqual([]);
	expect(probe).toHaveBeenCalledTimes(3);
});

test("external preparation leaves the asset registry and cache untouched", async () => {
	await writeFile(join(root, "episode.srt"), text);
	const discovery = await discover();
	const track = discovery.tracks.find((track) => track.origin === "external");
	if (!track) throw new Error("Missing external track");
	const response = await app.inject({
		method: "POST",
		url: `/api/files/${fileId}/subtitles/${track.id}/prepare`,
		headers,
		payload: {
			sourceVersion: discovery.sourceVersion,
			subtitleVersion: track.sourceVersion,
		},
	});
	expect(response.statusCode).toBe(200);
	expect(response.json().status).toBe("ready");
	expect(extract).not.toHaveBeenCalled();
	expect(database.subtitles.list()).toEqual([]);
	await expect(
		readdir(join(dataDir, "cache", "subtitles")),
	).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(join(root, "episode.srt"), "utf8")).toBe(text);
});
