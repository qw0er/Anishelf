import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	validatePolicy,
} from "../src/app/policy.js";
import { readSubtitleText } from "../src/modules/media/subtitles/infrastructure/content.js";
import { discoverExternalSubtitles } from "../src/modules/media/subtitles/infrastructure/discovery.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { resourceRootId } from "../src/modules/resources/resource-access/domain/identity.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import { runTool } from "../src/platform/media/process.js";
import { ConfigurationService } from "./support/configuration.js";
import { createHttpApp } from "./support/http.js";
import { createLibraryModule } from "./support/library.js";

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
	expect(service.settings).toEqual({ resourceRoots: [] });
	expect(service.snapshot.settings.preparationMode).toBe("compatible");
	await expect(readFile(join(dataDir, "settings.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect(Object.isFrozen(service.snapshot.settings.resourceRoots)).toBe(true);
	expect(() => {
		(service.snapshot.settings as { preparationMode: string }).preparationMode =
			"fast";
	}).toThrow(TypeError);
});

test("initial resource root persists once and later UI changes survive reload", async () => {
	const root = join(directory, "media");
	await mkdir(root);
	const env = { ...environment(), ANISHELF_INITIAL_RESOURCE_ROOT: root };
	const service = await ConfigurationService.load(env);
	expect(service.settings).toEqual({ resourceRoots: [root] });
	const file = join(dataDir, "settings.json");
	expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
		resourceRoots: [root],
	});
	if (process.platform !== "win32")
		expect((await stat(file)).mode & 0o777).toBe(0o600);
	await service.update({ resourceRoots: [] });
	const original = await readFile(file, "utf8");
	expect((await ConfigurationService.load(env)).settings).toEqual({
		resourceRoots: [],
	});
	expect(await readFile(file, "utf8")).toBe(original);
});

test.each(["missing", "file", "nested", "same", "ancestor", "symlink"])(
	"rejects invalid initial root (%s) without publishing settings",
	async (kind) => {
		let root = join(directory, "media");
		if (kind === "file") await writeFile(root, "not a directory");
		if (kind === "nested") root = join(dataDir, "media");
		if (kind === "same") root = dataDir;
		if (kind === "ancestor") root = directory;
		if (kind === "symlink") {
			await mkdir(dataDir);
			await symlink(dataDir, root, "dir");
		}
		await expect(
			ConfigurationService.load({
				...environment(),
				ANISHELF_INITIAL_RESOURCE_ROOT: root,
			}),
		).rejects.toMatchObject({ code: "CONFIG_INVALID" });
		await expect(
			readFile(join(dataDir, "settings.json")),
		).rejects.toMatchObject({ code: "ENOENT" });
	},
);

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"rejects unreadable initial media without persisting settings",
	async () => {
		const root = join(directory, "media");
		await mkdir(root);
		await chmod(root, 0o000);
		try {
			await expect(
				ConfigurationService.load({
					...environment(),
					ANISHELF_INITIAL_RESOURCE_ROOT: root,
				}),
			).rejects.toMatchObject({ code: "CONFIG_INVALID" });
			await expect(
				readFile(join(dataDir, "settings.json")),
			).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await chmod(root, 0o700);
		}
	},
);

test("existing settings win over unavailable initial media; malformed settings are not replaced", async () => {
	await mkdir(dataDir);
	const file = join(dataDir, "settings.json");
	const env = {
		...environment(),
		ANISHELF_INITIAL_RESOURCE_ROOT: join(directory, "missing"),
	};
	await writeFile(file, '{"resourceRoots":[]}');
	expect((await ConfigurationService.load(env)).settings).toEqual({
		resourceRoots: [],
	});
	await writeFile(file, "");
	await expect(ConfigurationService.load(env)).rejects.toMatchObject({
		code: "CONFIG_INVALID",
	});
	expect(await readFile(file, "utf8")).toBe("");
});

test("concurrent initializers publish one complete settings file without overwriting", async () => {
	const roots = [join(directory, "first"), join(directory, "second")];
	await Promise.all(roots.map((root) => mkdir(root)));
	const services = await Promise.all(
		roots.map((root) =>
			ConfigurationService.load({
				...environment(),
				ANISHELF_INITIAL_RESOURCE_ROOT: root,
			}),
		),
	);
	const saved = JSON.parse(
		await readFile(join(dataDir, "settings.json"), "utf8"),
	);
	expect(roots).toContain(saved.resourceRoots[0]);
	for (const service of services) expect(service.settings).toEqual(saved);
	expect(await readdir(dataDir)).toEqual(["settings.json"]);
});
test("old settings adopt updated defaults; explicit choices persist and snapshots remain fixed", async () => {
	const root = join(directory, "media");
	await mkdir(root);
	await mkdir(dataDir);
	await writeFile(
		join(dataDir, "settings.json"),
		JSON.stringify({ resourceRoots: [root] }),
	);
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.library.changeDebounceMs = 700;
	const service = await ConfigurationService.load(environment(), policy);
	const previous = service.snapshot;
	policy.library.changeDebounceMs = 9900;
	expect(Object.isFrozen(service.snapshot.settings)).toBe(true);
	await service.update({ resourceRoots: [root] });
	expect(previous.settings.resourceRoots).toEqual([root]);
	expect(service.snapshot.settings).not.toHaveProperty("scanIntervalMinutes");
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual({ resourceRoots: [root] });
	const reload = await ConfigurationService.load(environment(), policy);
	expect(reload.snapshot.settings).not.toHaveProperty("scanIntervalMinutes");
	await reload.update({ resourceRoots: [root] });
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual({ resourceRoots: [root] });
});
test("invalid settings and failed writes preserve the published snapshot", async () => {
	const service = await ConfigurationService.load(environment());
	const before = service.snapshot;
	await expect(
		service.update({ resourceRoots: ["relative"] }),
	).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	expect(service.snapshot).toBe(before);
	await mkdir(join(dataDir, "settings.json"));
	await expect(service.update({ resourceRoots: [] })).rejects.toMatchObject({
		code: "CONFIG_WRITE_FAILED",
	});
	expect(service.snapshot).toBe(before);
	await rm(join(dataDir, "settings.json"), { recursive: true });
	await service.update({ resourceRoots: [] });
	expect(service.snapshot.settings).not.toHaveProperty("scanIntervalMinutes");
});
test.each([
	{ resourceRoots: [], unexpected: 1 },
	{ resourceRoots: ["relative"] },
	{ resourceRoots: [null] },
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
	policy.resourceAccess.videoMimeTypes = {
		...policy.resourceAccess.videoMimeTypes,
		".avi": "video/avi",
	};
	expect(() => validatePolicy(policy)).toThrow("videoMimeTypes..avi");
	policy.resourceAccess.videoMimeTypes =
		builtinPolicy.resourceAccess.videoMimeTypes;
	policy.playback.sessionIdleMs = Infinity;
	expect(() => validatePolicy(policy)).toThrow("sessionIdleMs");
});
test("removed client configuration endpoint returns 404 and settings enforce injected constraints", async () => {
	const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
	policy.http.httpBodyMaximumBytes = 128;
	const configuration = await ConfigurationService.load(environment(), policy);
	const library = createLibraryModule({
		configuration,
		policy,
		index: new LibraryIndex(),
		logger,
	});
	const app = createHttpApp({
		config: configuration.deployment,
		policy,
		logger,
		library,
	});
	try {
		const response = await app.inject({
			headers: { host: "127.0.0.1:3000" },
			url: "/api/client-config",
		});
		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: { code: "ROUTE_NOT_FOUND" },
		});
		expect(
			(
				await app.inject({
					method: "PUT",
					headers: { host: "127.0.0.1:3000" },
					url: "/api/settings",
					payload: {
						resourceRoots: [join(directory, "media")],
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
					payload: { resourceRoots: [`/${"x".repeat(256)}`] },
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
	const resources = await ResourceAccess.create(
		{ resourceRoots: [root] },
		policy,
	);
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
	const database = ApplicationDatabase.openMemory(policy);
	try {
		const source = database.playback.registerSource(
			{
				scopeId: resourceRootId("/media"),
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
			database.playback.listHistory([source.rootId], 1, 0, "continue"),
		).toHaveLength(1);
		expect(() =>
			database.playback.listHistory([source.rootId], 2, 0, "continue"),
		).toThrow("must not exceed 1");
	} finally {
		database.close();
	}
});
test("tool execution uses injected output and timeout defaults", async () => {
	const policy = {
		...builtinPolicy.mediaTools,
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

test("subtitle reads use the supplied chunk size and still detect a growing source", async () => {
	const root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.srt"), "abcde");
	const resources = await ResourceAccess.create({ resourceRoots: [root] });
	const file = await resources.openSubtitleFile("episode.srt");
	try {
		const read = vi.spyOn(file.handle, "read");
		expect(await readSubtitleText(file, 5, 2)).toBe("abcde");
		expect(
			(read.mock.calls as unknown as unknown[][]).map((call) => call[2]),
		).toEqual([2, 2, 2, 1]);
	} finally {
		await file.release();
	}
	const growing = await resources.openSubtitleFile("episode.srt");
	try {
		await writeFile(join(root, "episode.srt"), "abcdef");
		await expect(readSubtitleText(growing, 5, 2)).rejects.toMatchObject({
			code: "SUBTITLE_TOO_LARGE",
		});
	} finally {
		await growing.release();
	}
});
test.each(["readChunkBytes", "extractionConcurrency"] as const)(
	"rejects invalid subtitle %s",
	(key) => {
		const policy = structuredClone(builtinPolicy) as BuiltinPolicy;
		policy.subtitles[key] = 0;
		expect(() => validatePolicy(policy)).toThrow(key);
	},
);

test.each([false, true])(
	"initializes the qBittorrent browser URL with a media initializer (%s)",
	async (withRoot) => {
		const root = join(directory, "media");
		await mkdir(root);
		const env = {
			...environment(),
			ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL: "http://localhost:8080",
			...(withRoot ? { ANISHELF_INITIAL_RESOURCE_ROOT: root } : {}),
		};
		const service = await ConfigurationService.load(env);
		expect(service.settings).toEqual({
			resourceRoots: withRoot ? [root] : [],
			qbittorrentWebUiUrl: "http://localhost:8080/",
		});
		const file = join(dataDir, "settings.json");
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual(service.settings);
		if (process.platform !== "win32")
			expect((await stat(file)).mode & 0o777).toBe(0o600);
		await service.update({ ...service.settings, qbittorrentWebUiUrl: null });
		const saved = await readFile(file, "utf8");
		expect(
			(await ConfigurationService.load(env)).settings.qbittorrentWebUiUrl,
		).toBeNull();
		expect(await readFile(file, "utf8")).toBe(saved);
	},
);

test("the qBittorrent initializer preserves an existing settings file without a URL", async () => {
	const service = await ConfigurationService.load(environment());
	await service.update({ resourceRoots: [] });
	const file = join(dataDir, "settings.json");
	const saved = await readFile(file, "utf8");
	const reloaded = await ConfigurationService.load({
		...environment(),
		ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL: "http://localhost:8080",
	});
	expect(reloaded.settings).toEqual({ resourceRoots: [] });
	expect(await readFile(file, "utf8")).toBe(saved);
});

test("concurrent URL initializers publish one complete settings file", async () => {
	const urls = ["http://localhost:8080/", "https://downloads.example.com/"];
	await Promise.all(
		urls.map((url) =>
			ConfigurationService.load({
				...environment(),
				ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL: url,
			}),
		),
	);
	const saved = JSON.parse(
		await readFile(join(dataDir, "settings.json"), "utf8"),
	);
	expect(saved.resourceRoots).toEqual([]);
	expect(urls).toContain(saved.qbittorrentWebUiUrl);
	expect((await ConfigurationService.load(environment())).settings).toEqual(
		saved,
	);
});

test.each([0, -1, 1.5, 1441, "30", null])(
	"startup rejects invalid RSS refresh interval %j",
	async (rssRefreshIntervalMinutes) => {
		await mkdir(dataDir, { recursive: true });
		await writeFile(
			join(dataDir, "settings.json"),
			JSON.stringify({ resourceRoots: [], rssRefreshIntervalMinutes }),
		);
		await expect(
			ConfigurationService.load(environment()),
		).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	},
);
