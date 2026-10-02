import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	validatePolicy,
} from "../src/config/policy.js";
import { ConfigurationService } from "../src/config/service.js";
import { ApplicationDatabase } from "../src/database/index.js";
import { createHttpApp } from "../src/http/app.js";
import { LibraryIndex } from "../src/library/index.js";
import { runTool } from "../src/media/process.js";
import { ResourceAccess } from "../src/resources/access.js";
import { readSubtitleText } from "../src/subtitles/content.js";
import { discoverExternalSubtitles } from "../src/subtitles/discovery.js";

let directory: string;
let dataDir: string;
const logger = pino({ enabled: false });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-unified-"));
	dataDir = join(directory, "data");
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
const environment = () => ({ ANISHELF_DATA_DIR: dataDir });

test("missing settings use current defaults without generating a policy or settings file", async () => {
	const service = await ConfigurationService.load(environment());
	expect(service.settings).toEqual({ resourceRoot: null });
	expect(service.snapshot.settings.scanIntervalMinutes).toBe(60);
	await expect(readFile(join(dataDir, "settings.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect(Object.isFrozen(service.snapshot.policy.subtitles.formats)).toBe(true);
	expect(() => {
		(
			service.snapshot.settings as { scanIntervalMinutes: number }
		).scanIntervalMinutes = 9;
	}).toThrow(TypeError);
});
test("old settings adopt updated defaults; explicit choices persist and snapshots remain fixed", async () => {
	const root = join(directory, "media");
	await mkdir(root);
	await mkdir(dataDir);
	await writeFile(
		join(dataDir, "settings.json"),
		JSON.stringify({ resourceRoot: root }),
	);
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.library.defaultScanIntervalMinutes = 7;
	const service = await ConfigurationService.load(environment(), policy);
	const previous = service.snapshot;
	policy.library.defaultScanIntervalMinutes = 99;
	expect(service.snapshot.settings.scanIntervalMinutes).toBe(7);
	await service.update({ resourceRoot: root, scanIntervalMinutes: 0 });
	expect(previous.settings.scanIntervalMinutes).toBe(7);
	expect(service.snapshot.settings.scanIntervalMinutes).toBe(0);
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual({ resourceRoot: root, scanIntervalMinutes: 0 });
	const reload = await ConfigurationService.load(environment(), policy);
	expect(reload.snapshot.settings.scanIntervalMinutes).toBe(0);
	await reload.update({ resourceRoot: root });
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual({ resourceRoot: root });
});
test("invalid settings and failed writes preserve the published snapshot", async () => {
	const service = await ConfigurationService.load(environment());
	const before = service.snapshot;
	await expect(
		service.update({ resourceRoot: null, scanIntervalMinutes: 10081 }),
	).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	expect(service.snapshot).toBe(before);
	await mkdir(join(dataDir, "settings.json"));
	await expect(service.update({ resourceRoot: null })).rejects.toMatchObject({
		code: "CONFIG_WRITE_FAILED",
	});
	expect(service.snapshot).toBe(before);
	await rm(join(dataDir, "settings.json"), { recursive: true });
	await service.update({ resourceRoot: null, scanIntervalMinutes: 0 });
	expect(service.snapshot.settings.scanIntervalMinutes).toBe(0);
});
test.each([
	{ resourceRoot: null, unexpected: 1 },
	{ resourceRoot: null, scanIntervalMinutes: -1 },
	{ resourceRoot: null, scanIntervalMinutes: 1.5 },
])(
	"rejects malformed persistent settings with key diagnostics: %j",
	async (settings) => {
		await mkdir(dataDir);
		await writeFile(join(dataDir, "settings.json"), JSON.stringify(settings));
		await expect(
			ConfigurationService.load(environment()),
		).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	},
);
test("rejects unsupported capabilities, invalid limits and timing values", () => {
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.media.videoMimeTypes = {
		...policy.media.videoMimeTypes,
		".avi": "video/avi",
	};
	expect(() => validatePolicy(policy)).toThrow("videoMimeTypes..avi");
	policy.media.videoMimeTypes = builtinPolicy.media.videoMimeTypes;
	policy.client.progressSaveIntervalMs = Infinity;
	expect(() => validatePolicy(policy)).toThrow("progressSaveIntervalMs");
});
test("client API whitelists supported values and HTTP settings share injected constraints", async () => {
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.library.maximumScanIntervalMinutes = 10;
	policy.library.defaultScanIntervalMinutes = 3;
	policy.runtime.httpBodyMaximumBytes = 128;
	const configuration = await ConfigurationService.load(environment(), policy);
	const library = new LibraryApplication({
		configuration,
		policy: configuration.policy,
		index: new LibraryIndex(),
		logger,
	});
	const app = createHttpApp({
		config: configuration.deployment,
		policy: configuration.policy,
		logger,
		library,
	});
	try {
		const response = await app.inject({
			headers: { host: "127.0.0.1:3000" },
			url: "/api/client-config",
		});
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(Object.keys(body).sort()).toEqual([
			"defaultLanguage",
			"library",
			"media",
			"playback",
			"subtitles",
		]);
		expect(body.library).toEqual({
			defaultScanIntervalMinutes: 3,
			maximumScanIntervalMinutes: 10,
		});
		expect(JSON.stringify(body)).not.toContain(dataDir);
		expect(body.runtime).toBeUndefined();
		expect(
			(
				await app.inject({
					method: "PUT",
					headers: { host: "127.0.0.1:3000" },
					url: "/api/settings",
					payload: {
						resourceRoot: join(directory, "media"),
						scanIntervalMinutes: 11,
					},
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await app.inject({
					method: "PUT",
					headers: { host: "127.0.0.1:3000" },
					url: "/api/settings",
					payload: { resourceRoot: `/${"x".repeat(256)}` },
				})
			).statusCode,
		).toBe(413);
	} finally {
		await app.close();
	}
});
test("injected subtitle bounds govern discovery and reads at the exact boundary", async () => {
	const root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mp4"), "media");
	await writeFile(join(root, "episode.srt"), "abc");
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.subtitles.maximumBytes = 3;
	const resources = await ResourceAccess.create({ resourceRoot: root }, policy);
	expect(
		(
			await discoverExternalSubtitles(
				resources,
				"episode.mp4",
				"v",
				policy.subtitles,
			)
		).tracks,
	).toHaveLength(1);
	const file = await resources.openSubtitleFile("episode.srt");
	try {
		expect(await readSubtitleText(file, 3)).toBe("abc");
		await expect(readSubtitleText(file, 2)).rejects.toMatchObject({
			code: "SUBTITLE_TOO_LARGE",
		});
	} finally {
		await file.release();
	}
	await writeFile(join(root, "episode.srt"), "abcd");
	expect(
		(
			await discoverExternalSubtitles(
				resources,
				"episode.mp4",
				"v",
				policy.subtitles,
			)
		).warnings[0]?.code,
	).toBe("SUBTITLE_TOO_LARGE");
});
test("injected near-end thresholds and batch limits control database selection", () => {
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.playback.nearEndMs = 1000;
	policy.playback.nearEndRatio = 0.01;
	policy.playback.candidateBatchSize = 1;
	const database = ApplicationDatabase.open(dataDir, policy);
	try {
		const source = database.playback.registerSource(
			{
				canonicalRoot: "/media",
				relativePath: "episode.mp4",
				fileId: "file",
				sourceVersion: "v",
			},
			1,
		);
		const progress = database.playback.openGeneration(source.id);
		database.playback.save(
			{
				sourceId: source.id,
				generation: progress.generation,
				sequence: 1,
				positionMs: 98000,
				durationMs: 100000,
			},
			2,
		);
		expect(
			database.playback.listContinueWatching(source.rootId, 1),
		).toHaveLength(1);
		expect(() =>
			database.playback.listContinueWatching(source.rootId, 2),
		).toThrow("must not exceed 1");
	} finally {
		database.close();
	}
});
test("tool execution uses injected output and timeout defaults", async () => {
	const policy = {
		...builtinPolicy.media,
		executionTimeoutMs: 30,
		maximumOutputBytes: 100,
	};
	await expect(
		runTool(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{},
			policy,
		),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
	await expect(
		runTool(
			process.execPath,
			["-e", "process.stdout.write('x'.repeat(10000))"],
			{ timeoutMs: 1000 },
			policy,
		),
	).rejects.toMatchObject({ code: "TOOL_FAILED" });
});
