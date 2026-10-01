import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import { PersistentConfiguration } from "../src/config/persistent.js";
import { createHttpApp } from "../src/http/app.js";
import { LibraryIndex } from "../src/library/index.js";
import { ResourceAccess } from "../src/resources/access.js";

const headers = { host: "127.0.0.1:3000" };
let fixture: string;
let dataDir: string;
let root: string;
let configuration: PersistentConfiguration;
let index: LibraryIndex;
let libraryApp: LibraryApplication;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-settings-http-"));
	dataDir = join(fixture, "data");
	root = join(fixture, "中文 media");
	await mkdir(dataDir);
	await mkdir(root);
	configuration = await PersistentConfiguration.load(dataDir);
	index = new LibraryIndex();
	const logger = pino({ enabled: false });
	libraryApp = new LibraryApplication({ index, configuration, logger });
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library: libraryApp,
	});
});

afterEach(async () => {
	await app.close();
	vi.restoreAllMocks();
	await rm(fixture, { recursive: true, force: true });
});

function save(resourceRoot = root) {
	return app.inject({
		method: "PUT",
		url: "/api/settings",
		headers,
		payload: { resourceRoot },
	});
}

test("first-run HTTP setup persists settings and automatically scans the configured root", async () => {
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
	expect((await app.inject({ url: "/api/settings", headers })).json()).toEqual({
		resourceRoot: null,
	});
	expect(
		(await app.inject({ url: "/api/library", headers })).json(),
	).toMatchObject({
		ready: false,
		scan: null,
		error: { code: "RESOURCE_ROOT_NOT_CONFIGURED" },
	});
	const blocked = await app.inject({
		method: "POST",
		url: "/api/library/scan",
		headers,
	});
	expect(blocked.statusCode).toBe(409);
	expect(blocked.json().error.code).toBe("RESOURCE_ROOT_NOT_CONFIGURED");
	await writeFile(join(root, "episode.mp4"), "video");
	expect((await save()).statusCode).toBe(200);
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual({ resourceRoot: root });
	expect((await PersistentConfiguration.load(dataDir)).settings).toEqual({
		resourceRoot: root,
	});

	await libraryApp.waitForCompletion();
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"episode.mp4",
	]);
});

test.each([
	{},
	{ resourceRoot: null },
	{ resourceRoot: 123 },
	{ resourceRoot: "" },
	{ resourceRoot: "relative" },
	{ resourceRoot: "\0/media" },
	{ resourceRoot: "/media", port: 1234 },
])("invalid settings preserve setup mode: %j", async (payload) => {
	const response = await app.inject({
		method: "PUT",
		url: "/api/settings",
		headers,
		payload,
	});
	expect(response.statusCode).toBe(400);
	expect(configuration.settings).toEqual({ resourceRoot: null });
	expect(index.revision).toBe(0);
	await expect(readFile(join(dataDir, "settings.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("overlapping roots are rejected while missing separate roots can be saved and repaired", async () => {
	const overlap = await save(join(dataDir, "media"));
	expect(overlap.statusCode).toBe(400);
	expect(overlap.body).not.toContain(fixture);
	const missing = join(fixture, "missing");
	expect((await save(missing)).statusCode).toBe(200);
	expect(
		(await app.inject({ url: "/api/library", headers })).json(),
	).toMatchObject({
		ready: false,
		error: { code: "RESOURCE_ROOT_UNAVAILABLE" },
	});
	await mkdir(missing);
	expect(
		(await app.inject({ url: "/api/library", headers })).json(),
	).toMatchObject({ ready: true, error: null });
});

test("changing the root drops previous file IDs and automatically scans the new root", async () => {
	await save();
	await libraryApp.waitForCompletion();
	await writeFile(join(root, "old.mp4"), "old");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const old = index.listChildren("root")[0];
	const revision = index.revision;
	const other = join(fixture, "other");
	await mkdir(other);
	await writeFile(join(other, "new.mp4"), "new");
	await save(other);
	expect(index.revision).toBeGreaterThanOrEqual(revision + 1);
	expect(libraryApp.state).not.toBeNull();
	expect(
		(await app.inject({ url: `/api/files/${old?.id}`, headers })).statusCode,
	).toBe(404);
	await libraryApp.waitForCompletion();
	expect(index.revision).toBe(revision + 2);
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"new.mp4",
	]);
});

test("a failed disk save preserves current settings and the published index", async () => {
	await save();
	await libraryApp.waitForCompletion();
	await writeFile(join(root, "old.mp4"), "old");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const snapshot = index.snapshot;
	const state = libraryApp.state;
	await rm(dataDir, { recursive: true });
	const response = await save(join(fixture, "other"));
	expect(response.statusCode).toBe(500);
	expect(response.json().error.code).toBe("CONFIG_WRITE_FAILED");
	expect(response.body).not.toContain(fixture);
	expect(configuration.settings.resourceRoot).toBe(root);
	expect(index.snapshot).toEqual(snapshot);
	expect(libraryApp.state).toEqual(state);
});

test("saving the same resource directory preserves scan results", async () => {
	await save();
	await libraryApp.waitForCompletion();
	await writeFile(join(root, "old.mp4"), "old");
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const snapshot = index.snapshot;
	const state = libraryApp.state;
	expect((await save()).statusCode).toBe(200);
	expect(index.snapshot).toEqual(snapshot);
	expect(libraryApp.state).toEqual(state);
});

test("a running scan rejects settings changes", async () => {
	await save();
	await libraryApp.waitForCompletion();
	const create = ResourceAccess.create;
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(ResourceAccess, "create").mockImplementation(async (settings) => {
		await gate;
		return create(settings);
	});
	await libraryApp.startScan();
	try {
		const response = await save(join(fixture, "other"));
		expect(response.statusCode).toBe(409);
		expect(response.json().error.code).toBe("SETTINGS_BUSY");
		expect(configuration.settings.resourceRoot).toBe(root);
	} finally {
		release?.();
	}
	await libraryApp.waitForCompletion();
});

test("an in-flight save blocks another save and scan without partial changes", async () => {
	await save();
	await libraryApp.waitForCompletion();
	const update = configuration.update.bind(configuration);
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let saving: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		saving = resolve;
	});
	vi.spyOn(configuration, "update").mockImplementation(async (settings) => {
		saving?.();
		await gate;
		return update(settings);
	});
	const pending = save(join(fixture, "other"));
	const responsePromise = pending.then((response) => response);
	await started;
	try {
		expect((await save()).statusCode).toBe(409);
		expect(
			(await app.inject({ method: "POST", url: "/api/library/scan", headers }))
				.statusCode,
		).toBe(409);
		expect(configuration.settings.resourceRoot).toBe(root);
	} finally {
		release?.();
	}
	expect((await responsePromise).statusCode).toBe(200);
});

test("foreign origins cannot save settings", async () => {
	const response = await app.inject({
		method: "PUT",
		url: "/api/settings",
		headers: { ...headers, origin: "https://foreign.example" },
		payload: { resourceRoot: root },
	});
	expect(response.statusCode).toBe(403);
	expect(configuration.settings.resourceRoot).toBeNull();
});

test("scan interval can be changed without rescanning or resetting the root and survives root-only updates", async () => {
	await save();
	await libraryApp.waitForCompletion();
	const revision = index.revision;
	const response = await app.inject({
		method: "PUT",
		url: "/api/settings",
		headers,
		payload: { resourceRoot: root, scanIntervalMinutes: 0 },
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		resourceRoot: root,
		scanIntervalMinutes: 0,
	});
	expect(index.revision).toBe(revision);
	expect((await app.inject({ url: "/api/settings", headers })).json()).toEqual({
		resourceRoot: root,
		scanIntervalMinutes: 0,
	});
	await save();
	expect(configuration.settings.scanIntervalMinutes).toBe(0);
});

test.each([-1, 1.5, 10081, "60", null])(
	"HTTP rejects invalid scan interval %j without saving",
	async (scanIntervalMinutes) => {
		const response = await app.inject({
			method: "PUT",
			url: "/api/settings",
			headers,
			payload: { resourceRoot: root, scanIntervalMinutes },
		});
		expect(response.statusCode).toBe(400);
		expect(configuration.settings.resourceRoot).toBeNull();
	},
);
