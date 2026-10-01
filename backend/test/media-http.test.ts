import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LibraryApplication } from "../src/application/library.js";
import { DomainError } from "../src/errors.js";
import { createHttpApp } from "../src/http/app.js";
import type { FileResponse } from "../src/http/contracts.js";
import { LibraryIndex } from "../src/library/index.js";
import { ResourceAccess } from "../src/resources/access.js";
import { settingsStore } from "./settings-store.js";

const headers = { host: "127.0.0.1:3000" };
let fixture: string;
let path: string;
let id: string;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-media-http-"));
	const root = join(fixture, "media");
	await mkdir(join(root, "中文 folder"), { recursive: true });
	path = join(root, "中文 folder", "episode 01.MP4");
	await writeFile(path, "0123456789");
	const index = new LibraryIndex();
	const configuration = settingsStore(root);
	const logger = pino({ enabled: false });
	const libraryApp = new LibraryApplication({ index, configuration, logger });
	await libraryApp.startScan();
	await libraryApp.waitForCompletion();
	const entry = [...index.snapshot.entriesById.values()].find(
		(entry) => entry.kind === "file",
	);
	if (!entry) throw new Error("Fixture was not scanned");
	id = entry.id;
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

test("returns current file metadata and a working same-origin playback URL", async () => {
	await writeFile(path, "updated media");
	const response = await app.inject({ url: `/api/files/${id}`, headers });
	expect(response.statusCode).toBe(200);
	expect(response.headers["cache-control"]).toBe("no-store");
	const body: FileResponse = response.json();
	expect(body).toEqual({
		file: {
			kind: "file",
			id,
			parentId: expect.any(String),
			name: "episode 01.MP4",
			sizeBytes: 13,
			modifiedAt: expect.any(String),
			mimeType: "video/mp4",
		},
		playbackUrl: `/api/media/${id}`,
	});
	expect(response.body).not.toContain("relativePath");
	expect(response.body).not.toContain(fixture);
	const media = await app.inject({ url: body.playbackUrl, headers });
	expect(media.statusCode).toBe(200);
	expect(media.body).toBe("updated media");
	expect(media.headers).toMatchObject({
		"content-type": "video/mp4",
		"content-length": "13",
		"accept-ranges": "bytes",
		"cache-control": "no-store",
		"x-request-id": expect.any(String),
	});
});

test.each([
	["bytes=2-5", "2345", "bytes 2-5/10"],
	["bytes=6-", "6789", "bytes 6-9/10"],
	["bytes=-3", "789", "bytes 7-9/10"],
	["bytes=-99999999999999999999999", "0123456789", "bytes 0-9/10"],
	["bytes=8-99999999999999999999999", "89", "bytes 8-9/10"],
])("serves range %s", async (range, body, contentRange) => {
	const response = await app.inject({
		url: `/api/media/${id}`,
		headers: { ...headers, range },
	});
	expect(response.statusCode).toBe(206);
	expect(response.body).toBe(body);
	expect(response.headers["content-range"]).toBe(contentRange);
	expect(response.headers["content-length"]).toBe(String(body.length));
});

test.each(["bytes=10-", "bytes=99999999999999999999999-", "bytes=-0"])(
	"rejects unsatisfiable range %s",
	async (range) => {
		const response = await app.inject({
			url: `/api/media/${id}`,
			headers: { ...headers, range },
		});
		expect(response.statusCode).toBe(416);
		expect(response.headers["content-range"]).toBe("bytes */10");
		expect(response.body).toBe("");
	},
);

test.each(["bytes=5-2", "bytes=-", "bytes=0-1,4-5", "nonsense"])(
	"ignores malformed or multipart range %s",
	async (range) => {
		const response = await app.inject({
			url: `/api/media/${id}`,
			headers: { ...headers, range },
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("0123456789");
		expect(response.headers["content-range"]).toBeUndefined();
	},
);

test("HEAD ignores Range, and an unverifiable If-Range returns the full file", async () => {
	const response = await app.inject({
		method: "HEAD",
		url: `/api/media/${id}`,
		headers: { ...headers, range: "bytes=99-" },
	});
	expect(response.statusCode).toBe(200);
	expect(response.body).toBe("");
	expect(response.headers["content-length"]).toBe("10");
	expect(response.headers["content-range"]).toBeUndefined();
	const full = await app.inject({
		url: `/api/media/${id}`,
		headers: { ...headers, range: "bytes=2-5", "if-range": '"unknown"' },
	});
	expect(full.statusCode).toBe(200);
	expect(full.body).toBe("0123456789");
});

test("handles empty files without creating an invalid stream", async () => {
	await truncate(path, 0);
	const response = await app.inject({ url: `/api/media/${id}`, headers });
	expect(response.statusCode).toBe(200);
	expect(response.body).toBe("");
	expect(response.headers["content-length"]).toBe("0");
	const ranged = await app.inject({
		url: `/api/media/${id}`,
		headers: { ...headers, range: "bytes=0-" },
	});
	expect(ranged.statusCode).toBe(416);
	expect(ranged.headers["content-range"]).toBe("bytes */0");
});

test.each(["files", "media"])(
	"validates %s IDs and reports missing files without exposing paths",
	async (route) => {
		for (const unknown of ["unknown", "root"]) {
			const response = await app.inject({
				url: `/api/${route}/${unknown}`,
				headers,
			});
			expect(response.statusCode).toBe(404);
			expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
		}
		const invalid = await app.inject({
			url: `/api/${route}/invalid%20id`,
			headers,
		});
		expect(invalid.statusCode).toBe(400);
		expect(invalid.json().error.code).toBe("INVALID_REQUEST");
		await rm(path);
		const missing = await app.inject({ url: `/api/${route}/${id}`, headers });
		expect(missing.statusCode).toBe(404);
		expect(missing.json().error.code).toBe("RESOURCE_MISSING");
		expect(missing.body).not.toContain(fixture);
	},
);

test.each(["files", "media"])(
	"rejects symlink replacements in %s",
	async (route) => {
		const outside = join(fixture, "outside.mp4");
		await writeFile(outside, "private");
		await rm(path);
		await symlink(outside, path);
		const response = await app.inject({ url: `/api/${route}/${id}`, headers });
		expect(response.statusCode).toBe(403);
		expect(response.json().error.code).toBe("RESOURCE_ACCESS_DENIED");
		expect(response.body).not.toContain(fixture);
	},
);

test.each(["files", "media"])(
	"reports unreadable files in %s",
	async (route) => {
		vi.spyOn(ResourceAccess.prototype, "openFile").mockRejectedValue(
			new DomainError("RESOURCE_UNREADABLE", path),
		);
		const response = await app.inject({ url: `/api/${route}/${id}`, headers });
		expect(response.statusCode).toBe(403);
		expect(response.json().error.code).toBe("RESOURCE_UNREADABLE");
		expect(response.body).not.toContain(fixture);
	},
);

test("releases file handles on HEAD, failed range, completed stream, and disconnect", async () => {
	const opened: Awaited<ReturnType<ResourceAccess["openFile"]>>[] = [];
	const original = ResourceAccess.prototype.openFile;
	vi.spyOn(ResourceAccess.prototype, "openFile").mockImplementation(
		async function (this: ResourceAccess, path) {
			const file = await original.call(this, path);
			opened.push(file);
			return file;
		},
	);
	await app.inject({ url: `/api/files/${id}`, headers });
	await app.inject({ method: "HEAD", url: `/api/media/${id}`, headers });
	await app.inject({
		url: `/api/media/${id}`,
		headers: { ...headers, range: "bytes=99-" },
	});
	await app.inject({ url: `/api/media/${id}`, headers });
	await vi.waitFor(() =>
		expect(opened.every((file) => file.handle.fd === -1)).toBe(true),
	);
	await truncate(path, 32 * 1024 * 1024);
	const address = await app.listen({ host: "127.0.0.1", port: 0 });
	await new Promise<void>((resolve, reject) => {
		const request = get(`${address}/api/media/${id}`, (response) => {
			response.once("data", () => {
				response.destroy();
				resolve();
			});
			response.on("error", reject);
		});
		request.on("error", reject);
	});
	await vi.waitFor(() => {
		expect(opened).toHaveLength(5);
		expect(opened.every((file) => file.handle.fd === -1)).toBe(true);
	});
});
