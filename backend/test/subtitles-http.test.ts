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
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type { SubtitleDiscoveryResponse } from "../src/contracts/http.js";
import { builtinPolicy } from "../src/modules/configuration/domain/policy.js";
import type { LibraryApplication } from "../src/modules/library/application/library.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { ResourceAccess } from "../src/modules/resource-access/infrastructure/access.js";
import { SubtitleApplication } from "../src/modules/subtitles/application/subtitles.js";
import type { MediaInfo, MediaStream } from "../src/platform/media/index.js";
import { MediaToolError, MediaTools } from "../src/platform/media/index.js";
import { runTool } from "../src/platform/media/process.js";
import { DomainError } from "../src/shared/errors.js";

const maximumSubtitleBytes = builtinPolicy.subtitles.maximumBytes;

import { settingsStore } from "./settings-store.js";

let fixture: string;
let root: string;
let library: LibraryApplication;
let app: ReturnType<typeof createHttpApp>;
let fileId: string;
const emptyInfo: MediaInfo = {
	format: "matroska",
	formatAliases: ["matroska"],
	container: "matroska",
	duration: 2,
	size: null,
	bitRate: null,
	tags: {},
	streams: [],
};
let probe: ReturnType<typeof vi.fn<MediaTools["probe"]>>;
const video = "第 01 集 & 100%";
const headers = { host: "127.0.0.1:3000" };
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-subtitles-"));
	root = join(fixture, "media");
	await mkdir(join(root, "season"), { recursive: true });
	await writeFile(join(root, "season", `${video}.mkv`), "video");
	const logger = pino({ enabled: false });
	const index = new LibraryIndex();
	library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger,
	});
	probe = vi.fn<MediaTools["probe"]>().mockResolvedValue(emptyInfo);
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe },
	});
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
		subtitles: new SubtitleApplication({
			sources: library.sources,
			inspection,
		}),
	});
	app.addHook("onClose", async () => inspection.close());
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

function stream(
	index: number,
	codec: string | null,
	overrides: Partial<MediaStream> = {},
): MediaStream {
	return {
		index,
		type: "subtitle",
		codec,
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
		default: false,
		forced: false,
		...overrides,
	};
}

test("merges external and embedded tracks without exposing selectors or loading content", async () => {
	await sidecar(".srt", "untouched");
	probe.mockResolvedValue({
		...emptyInfo,
		streams: [
			stream(0, "h264", { type: "video" }),
			stream(2, "ass", {
				tags: { language: "zho", title: "Chinese" },
				default: true,
				forced: true,
			}),
			stream(3, "mov_text"),
			stream(4, "hdmv_pgs_subtitle"),
			stream(5, "webvtt"),
			stream(6, null),
		],
	});
	const result = await discover();
	expect(result.tracks).toHaveLength(6);
	expect(result.tracks[0]?.origin).toBe("external");
	expect(result.tracks[1]).toMatchObject({
		origin: "embedded",
		name: "Chinese",
		language: "zho",
		codec: "ass",
		format: "ass",
		default: true,
		forced: true,
		sizeBytes: null,
		supported: true,
		unsupportedReason: null,
	});
	expect(result.tracks[2]).toMatchObject({
		codec: "mov_text",
		format: "srt",
		supported: true,
	});
	expect(result.tracks[3]).toMatchObject({
		codec: "hdmv_pgs_subtitle",
		format: null,
		supported: false,
		unsupportedReason: "UNSUPPORTED_CODEC",
	});
	expect(result.tracks[4]?.format).toBe("vtt");
	expect(result.tracks[5]?.format).toBeNull();
	expect(JSON.stringify(result)).not.toContain("streamIndex");
	expect(new Set(result.tracks.map((t) => t.id)).size).toBe(6);
	expect((await discover()).tracks).toEqual(result.tracks);
	expect(probe).toHaveBeenCalledTimes(1);
});

test.each(["TOOL_UNAVAILABLE", "TOOL_FAILED", "INVALID_MEDIA"] as const)(
	"probe %s preserves external subtitles and permits retry",
	async (code) => {
		await sidecar(".srt");
		probe.mockRejectedValueOnce(new MediaToolError(code, `secret ${fixture}`));
		const result = await discover();
		expect(result.tracks).toHaveLength(1);
		expect(result.warnings).toEqual([
			{
				name: `${video}.mkv`,
				code:
					code === "TOOL_UNAVAILABLE"
						? "SUBTITLE_PROBE_UNAVAILABLE"
						: "SUBTITLE_PROBE_FAILED",
			},
		]);
		expect((await discover()).warnings).toEqual([]);
		expect(probe).toHaveBeenCalledTimes(2);
	},
);

test("reprobes changed videos and never reuses their embedded track IDs", async () => {
	probe.mockResolvedValue({ ...emptyInfo, streams: [stream(1, "subrip")] });
	const first = await discover();
	await writeFile(join(root, "season", `${video}.mkv`), "replacement video");
	const next = await discover();
	expect(next.sourceVersion).not.toBe(first.sourceVersion);
	expect(next.tracks[0]?.id).not.toBe(first.tracks[0]?.id);
	expect(probe).toHaveBeenCalledTimes(2);
});

test("rejects a source replaced during probing", async () => {
	probe.mockImplementationOnce(async () => {
		await writeFile(
			join(root, "season", `${video}.mkv`),
			"replaced while probing",
		);
		return emptyInfo;
	});
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles`,
		headers,
	});
	expect(response.statusCode).toBe(409);
});

test("shares a concurrent probe of the same source", async () => {
	let complete!: (info: MediaInfo) => void;
	probe.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const first = discover();
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
	const second = discover();
	complete(emptyInfo);
	await Promise.all([first, second]);
	expect(probe).toHaveBeenCalledTimes(1);
});

test("discovers real embedded MKV subtitles through the HTTP application", async () => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available || !tools.status.ffprobe.available)
		throw new Error("FFmpeg/FFprobe unavailable");
	await sidecar(".srt", "1\n00:00:00,200 --> 00:00:01,200\nHello\n");
	const target = join(root, "season", `${video}.mkv`);
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
		join(root, "season", `${video}.srt`),
		"-map",
		"0:v",
		"-map",
		"1:s",
		"-c:v",
		"ffv1",
		"-c:s",
		"copy",
		"-metadata:s:s:0",
		"language=eng",
		"-metadata:s:s:0",
		"title=English",
		target,
	]);
	probe.mockImplementation((path, signal) => tools.probe(path, signal));
	const result = await discover();
	expect(result.tracks.find((t) => t.origin === "embedded")).toMatchObject({
		codec: "subrip",
		format: "srt",
		language: "eng",
		name: "English",
		supported: true,
	});
});

test("bounds probing to one source while preserving sidecars and allowing retry", async () => {
	await writeFile(join(root, "season", "other.mkv"), "other video");
	await writeFile(join(root, "season", "other.srt"), "other subtitle");
	await library.startScan();
	await library.waitForCompletion();
	const directory = library.getDirectory("root").children[0];
	if (!directory) throw new Error("Missing directory");
	const other = library
		.getDirectory(directory.id)
		.children.find((entry) => entry.name === "other.mkv");
	if (!other) throw new Error("Missing other video");
	let complete!: (info: MediaInfo) => void;
	probe.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const first = discover();
	await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
	try {
		const response = await app.inject({
			url: `/api/files/${other.id}/subtitles`,
			headers,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			tracks: [{ origin: "external", name: "other.srt" }],
			warnings: [{ code: "SUBTITLE_PROBE_BUSY" }],
		});
		expect(probe).toHaveBeenCalledTimes(1);
	} finally {
		complete(emptyInfo);
		await first;
	}
	const retry = await app.inject({
		url: `/api/files/${other.id}/subtitles`,
		headers,
	});
	expect(retry.json().warnings).toEqual([]);
	expect(probe).toHaveBeenCalledTimes(2);
});

test("embedded descriptors cannot be read through the external content endpoint", async () => {
	probe.mockResolvedValue({ ...emptyInfo, streams: [stream(1, "ass")] });
	const result = await discover();
	const track = result.tracks[0];
	if (!track) throw new Error("Missing embedded track");
	const query = new URLSearchParams({
		sourceVersion: result.sourceVersion,
		subtitleVersion: track.sourceVersion,
	});
	const response = await app.inject({
		url: `/api/files/${fileId}/subtitles/${track.id}/content?${query}`,
		headers,
	});
	expect(response.statusCode).toBe(404);
});

async function prepareExternal(discovery: SubtitleDiscoveryResponse) {
	const track = discovery.tracks[0];
	if (!track) throw new Error("Missing track");
	return app.inject({
		method: "POST",
		url: `/api/files/${fileId}/subtitles/${track.id}/prepare`,
		headers: { ...headers, origin: "http://127.0.0.1:3000" },
		payload: {
			sourceVersion: discovery.sourceVersion,
			subtitleVersion: track.sourceVersion,
		},
	});
}

test.each(["srt", "vtt", "ass", "ssa"])(
	"prepares external %s through the common interface without an extractor or cache registry",
	async (format) => {
		await sidecar(`.${format}`, "original subtitle");
		probe.mockRejectedValue(
			new MediaToolError("TOOL_UNAVAILABLE", "Unavailable"),
		);
		const discovery = await discover();
		expect(discovery.tracks[0]).toMatchObject({
			supported: true,
			unsupportedReason: null,
		});
		const response = await prepareExternal(discovery);
		expect(response.statusCode).toBe(200);
		const result = response.json();
		expect(result).toMatchObject({
			status: "ready",
			format,
			statusUrl: null,
			errorCode: null,
		});
		expect(response.body).not.toContain(fixture);
		const content = await app.inject({ url: result.contentUrl, headers });
		expect(content.statusCode).toBe(200);
		expect(content.body).toBe("original subtitle");
	},
);

test("external preparation rejects replaced, missing and stale-video tracks", async () => {
	await sidecar(".srt", "original");
	const discovery = await discover();
	await sidecar(".srt", "changed subtitle");
	const replaced = await prepareExternal(discovery);
	expect(replaced.statusCode).toBe(409);
	expect(replaced.json().error.code).toBe("PLAYBACK_CONFLICT");
	await rm(join(root, "season", `${video}.srt`));
	expect((await prepareExternal(discovery)).statusCode).toBe(404);
	await sidecar(".srt", "original");
	const fresh = await discover();
	await writeFile(join(root, "season", `${video}.mkv`), "changed video");
	expect((await prepareExternal(fresh)).statusCode).toBe(409);
});

test("external ready URLs retain version checks after preparation", async () => {
	await sidecar(".srt", "original");
	const response = await prepareExternal(await discover());
	const result = response.json();
	await sidecar(".srt", "changed subtitle");
	const content = await app.inject({ url: result.contentUrl, headers });
	expect(content.statusCode).toBe(409);
	expect(content.json().error.code).toBe("PLAYBACK_CONFLICT");
});

test("external preparation reuses discovery rather than scanning the directory again", async () => {
	await sidecar(".srt", "original subtitle");
	const discovery = await discover();
	const reads = vi.spyOn(ResourceAccess.prototype, "readDirectory");
	const response = await prepareExternal(discovery);
	expect(response.statusCode).toBe(200);
	expect(reads).toHaveBeenCalledTimes(1);
});

test("external content rejects replacement between discovery and opening", async () => {
	await sidecar(".srt", "original subtitle");
	const url = await contentUrl();
	const open = ResourceAccess.prototype.openSubtitleFile;
	vi.spyOn(ResourceAccess.prototype, "openSubtitleFile")
		.mockImplementationOnce(async function (this: ResourceAccess, path) {
			// Directory discovery has checked the original version.
			return open.call(this, path);
		})
		.mockImplementationOnce(async function (this: ResourceAccess, path) {
			await sidecar(".srt", "replacement while opening");
			return open.call(this, path);
		});
	const response = await app.inject({ url, headers });
	expect(response.statusCode).toBe(409);
	expect(response.json().error.code).toBe("PLAYBACK_CONFLICT");
	expect(response.body).not.toContain("replacement while opening");
});

test("external content rejects a subtitle changed while reading the opened handle", async () => {
	await sidecar(".srt", "original subtitle");
	const url = await contentUrl();
	const open = ResourceAccess.prototype.openSubtitleSource;
	vi.spyOn(
		ResourceAccess.prototype,
		"openSubtitleSource",
	).mockImplementationOnce(async function (this: ResourceAccess, identity) {
		const file = await open.call(this, identity);
		const read = file.handle.read.bind(file.handle);
		vi.spyOn(file.handle, "read").mockImplementationOnce(async (...args) => {
			await sidecar(".srt", "replacement during read");
			return read(...args);
		});
		return file;
	});
	const response = await app.inject({ url, headers });
	expect(response.statusCode).toBe(409);
	expect(response.json().error.code).toBe("PLAYBACK_CONFLICT");
	expect(response.body).not.toContain("replacement during read");
});
