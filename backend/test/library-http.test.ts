import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import { DomainError } from "../src/errors.js";
import { createHttpApp } from "../src/http/app.js";
import type {
	DirectoryResponse,
	LibraryResponse,
	ScanResponse,
} from "../src/http/contracts.js";
import { LibraryIndex } from "../src/library/index.js";
import { ResourceAccess } from "../src/resources/access.js";
import { settingsStore } from "./settings-store.js";

const headers = { host: "127.0.0.1:3000" };
let fixture: string;
let root: string;
let index: LibraryIndex;
let libraryApp: LibraryApplication;
let app: ReturnType<typeof createHttpApp>;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-library-http-"));
	root = join(fixture, "media");
	await mkdir(root);
	index = new LibraryIndex();
	const logger = pino({ enabled: false });
	const configuration = settingsStore(root);
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

async function library(): Promise<LibraryResponse> {
	const response = await app.inject({ url: "/api/library", headers });
	expect(response.statusCode).toBe(200);
	return response.json();
}
async function directory(id = "root"): Promise<DirectoryResponse> {
	const response = await app.inject({ url: `/api/directories/${id}`, headers });
	expect(response.statusCode).toBe(200);
	expect(response.body).not.toContain("relativePath");
	expect(response.body).not.toContain(fixture);
	return response.json();
}
async function scan(): Promise<ScanResponse> {
	const response = await app.inject({
		method: "POST",
		url: "/api/library/scan",
		headers,
	});
	expect(response.statusCode).toBe(202);
	return response.json();
}

test("reports the initial library and empty root without automatically scanning", async () => {
	expect(await library()).toEqual({
		ready: true,
		revision: 0,
		scan: null,
		error: null,
		stale: false,
	});
	expect(await directory()).toEqual({
		directory: { kind: "directory", id: "root", parentId: null, name: "root" },
		children: [],
	});
});

test("scans, navigates direct children, and reflects repeat/add/remove scans", async () => {
	await mkdir(join(root, "中文 folder"));
	await mkdir(join(root, "empty"));
	await writeFile(join(root, "中文 folder", "nested.mp4"), "nested");
	await writeFile(join(root, "episode 10.mp4"), "ten");
	await writeFile(join(root, "episode 2.mp4"), "two");
	await writeFile(join(root, "notes.txt"), "excluded");
	const started = await scan();
	expect(started.scan.status).toBe("running");
	await libraryApp.waitForCompletion();
	expect(await library()).toMatchObject({
		ready: true,
		revision: 1,
		scan: { id: started.scan.id, status: "completed", matchedCount: 3 },
		error: null,
		stale: false,
	});
	const listing = await directory();
	expect(listing.children.map((entry) => entry.name)).toEqual([
		"empty",
		"中文 folder",
		"episode 2.mp4",
		"episode 10.mp4",
	]);
	const folder = listing.children[1];
	expect(folder).toBeDefined();
	const nested = await directory(folder?.id);
	expect(nested.directory.parentId).toBe("root");
	expect(nested.children).toEqual([
		{
			kind: "file",
			id: expect.any(String),
			parentId: folder?.id,
			name: "nested.mp4",
			sizeBytes: 6,
			modifiedAt: expect.any(String),
			mimeType: "video/mp4",
		},
	]);
	expect((await directory(listing.children[0]?.id)).children).toEqual([]);
	await scan();
	await libraryApp.waitForCompletion();
	expect((await directory()).children).toEqual(listing.children);
	await rm(join(root, "episode 10.mp4"));
	await rm(join(root, "中文 folder"), { recursive: true });
	await writeFile(join(root, "new.webm"), "new");
	await scan();
	await libraryApp.waitForCompletion();
	const updated = await directory();
	expect(updated.children.map((entry) => entry.name)).toEqual([
		"empty",
		"episode 2.mp4",
		"new.webm",
	]);
	expect(updated.children[1]?.id).toBe(listing.children[2]?.id);
	expect((await library()).revision).toBe(3);
	const missing = await app.inject({
		url: `/api/directories/${folder?.id}`,
		headers,
	});
	expect(missing.statusCode).toBe(404);
	expect(missing.json().error.code).toBe("RESOURCE_NOT_FOUND");
});

test("concurrent HTTP requests reuse one running scan and preserve the old listing", async () => {
	await writeFile(join(root, "old.mp4"), "old");
	await scan();
	await libraryApp.waitForCompletion();
	const old = await directory();
	await rm(join(root, "old.mp4"));
	await writeFile(join(root, "new.mp4"), "new");
	const original = ResourceAccess.create;
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const create = vi
		.spyOn(ResourceAccess, "create")
		.mockImplementation(async (settings) => {
			await gate;
			return original(settings);
		});
	try {
		const responses = await Promise.all([scan(), scan(), scan()]);
		expect(new Set(responses.map((response) => response.scan.id)).size).toBe(1);
		expect(create).toHaveBeenCalledTimes(1);
		expect(await directory()).toEqual(old);
		expect(await library()).toMatchObject({
			revision: 1,
			scan: { status: "running" },
		});
	} finally {
		release();
	}
	await libraryApp.waitForCompletion();
	expect((await library()).revision).toBe(2);
	expect((await directory()).children.map((entry) => entry.name)).toEqual([
		"new.mp4",
	]);
});

test("unavailable roots keep HTTP available, reject scan before work, and recover", async () => {
	await rm(root, { recursive: true });
	expect(await library()).toMatchObject({
		ready: false,
		revision: 0,
		scan: null,
		error: { code: "RESOURCE_ROOT_UNAVAILABLE" },
		stale: false,
	});
	const rejected = await app.inject({
		method: "POST",
		url: "/api/library/scan",
		headers,
	});
	expect(rejected.statusCode).toBe(503);
	expect(rejected.json().error).toMatchObject({
		code: "RESOURCE_ROOT_UNAVAILABLE",
		requestId: rejected.headers["x-request-id"],
	});
	expect(rejected.body).not.toContain(fixture);
	expect(libraryApp.state).toBeNull();
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
	await mkdir(root);
	await scan();
	await libraryApp.waitForCompletion();
	expect(await library()).toMatchObject({
		ready: true,
		revision: 1,
		error: null,
	});
});

test("failed rescans preserve a stale snapshot and expose safe errors until recovery", async () => {
	await writeFile(join(root, "kept.mp4"), "kept");
	await scan();
	await libraryApp.waitForCompletion();
	const old = await directory();
	const create = vi
		.spyOn(ResourceAccess, "create")
		.mockRejectedValue(
			new DomainError("RESOURCE_ROOT_UNAVAILABLE", `secret ${fixture}`),
		);
	await scan();
	await libraryApp.waitForCompletion();
	expect(await library()).toMatchObject({
		revision: 1,
		scan: { status: "failed", error: { code: "RESOURCE_ROOT_UNAVAILABLE" } },
		error: { code: "RESOURCE_ROOT_UNAVAILABLE" },
		stale: true,
	});
	expect(JSON.stringify(await library())).not.toContain(fixture);
	expect(await directory()).toEqual(old);
	create.mockRestore();
	await rename(root, join(fixture, "backup"));
	expect(await library()).toMatchObject({ ready: false, stale: true });
	await rename(join(fixture, "backup"), root);
	await scan();
	await libraryApp.waitForCompletion();
	expect(await library()).toMatchObject({
		revision: 2,
		error: null,
		stale: false,
	});
});

test("partial scans return safe warning summaries through HTTP", async () => {
	await mkdir(join(root, "blocked"));
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const read = resources.readDirectory.bind(resources);
	vi.spyOn(ResourceAccess, "create").mockResolvedValue(resources);
	vi.spyOn(resources, "readDirectory").mockImplementation(async (path = "") => {
		if (path === "blocked") throw new Error(`secret ${fixture}`);
		return read(path);
	});
	await scan();
	await libraryApp.waitForCompletion();
	expect(await library()).toMatchObject({
		revision: 1,
		scan: {
			status: "completed",
			warnings: { count: 1, messages: [expect.any(String)] },
		},
		error: null,
		stale: false,
	});
	expect(JSON.stringify(await library())).not.toContain(fixture);
});

test.each([
	{
		method: "POST",
		url: "/api/library/scan",
		payload: { resourceRoot: "/private" },
	},
	{ method: "POST", url: "/api/library/scan", payload: [] },
	{
		method: "POST",
		url: "/api/library/scan",
		payload: "null",
		headers: { "content-type": "application/json" },
	},
	{ method: "GET", url: "/api/directories/%2E%2E%2Fprivate" },
	{ method: "GET", url: "/api/directories/%2Fprivate" },
	{ method: "GET", url: `/api/directories/${"x".repeat(65)}` },
] as const)("rejects invalid browse requests: $url", async (request) => {
	const response = await app.inject({
		...request,
		headers: { ...headers, ...("headers" in request ? request.headers : {}) },
	});
	expect(response.statusCode).toBe(400);
	expect(response.json().error.code).toBe("INVALID_REQUEST");
	expect(response.json().error.requestId).toBe(
		response.headers["x-request-id"],
	);
	expect(libraryApp.state).toBeNull();
});

test("unknown and file IDs are not directories; foreign Origin cannot start scans", async () => {
	await writeFile(join(root, "video.mp4"), "video");
	await scan();
	await libraryApp.waitForCompletion();
	for (const id of ["unknown", (await directory()).children[0]?.id]) {
		const response = await app.inject({
			url: `/api/directories/${id}`,
			headers,
		});
		expect(response.statusCode).toBe(404);
		expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
	}
	const denied = await app.inject({
		method: "POST",
		url: "/api/library/scan",
		headers: { ...headers, origin: "https://evil.example" },
	});
	expect(denied.statusCode).toBe(403);
	expect(denied.json().error.code).toBe("REQUEST_FORBIDDEN");
	expect(index.revision).toBe(1);
});

test("closing the HTTP application closes its libraryApp", async () => {
	await app.close();
	await expect(libraryApp.startScan()).rejects.toThrow("shutting down");
});

test("accepts an empty JSON scan body", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/api/library/scan",
		headers,
		payload: {},
	});
	expect(response.statusCode).toBe(202);
	expect(response.json().scan.status).toBe("running");
	await libraryApp.waitForCompletion();
	expect((await library()).revision).toBe(1);
});

test("unexpected scan failures are reported without publishing or leaking details", async () => {
	vi.spyOn(ResourceAccess, "create").mockRejectedValue(
		new Error(`secret ${fixture}`),
	);
	await scan();
	await libraryApp.waitForCompletion();
	const response = await library();
	expect(response).toMatchObject({
		revision: 0,
		scan: { status: "failed", error: { code: "SCAN_FAILED" } },
		error: { code: "SCAN_FAILED" },
		stale: false,
	});
	expect(JSON.stringify(response)).not.toContain(fixture);
	expect(JSON.stringify(response)).not.toContain("secret");
});

test("HTTP shutdown cancels active scanning and waits for pending access", async () => {
	const original = ResourceAccess.create;
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(ResourceAccess, "create").mockImplementation(async (settings) => {
		await gate;
		return original(settings);
	});
	await scan();
	let stopped = false;
	const closing = app.close().then(() => {
		stopped = true;
	});
	try {
		await vi.waitFor(
			async () =>
				await expect(libraryApp.startScan()).rejects.toThrow("shutting down"),
		);
		expect(stopped).toBe(false);
	} finally {
		release();
		await closing;
	}
	expect(libraryApp.state?.status).toBe("cancelled");
	expect(index.revision).toBe(0);
});
