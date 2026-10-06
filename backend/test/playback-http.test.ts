import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type { PlaybackSessionResponse } from "../src/contracts/http.js";
import { builtinPolicy } from "../src/modules/configuration/policy.js";
import type { LibraryApplication } from "../src/modules/library/application/library.js";
import { createResourceId } from "../src/modules/library/domain/model.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";

const headers = { host: "127.0.0.1:3000" };
const fileId = createResourceId("file", "episode.mp4");
const logger = pino({ enabled: false });
let directory: string;
let root: string;
let library: LibraryApplication;
let playback: PlaybackApplication;
let database: ApplicationDatabase;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-playback-http-"));
	root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mp4"), "original video");
	database = ApplicationDatabase.open(join(directory, "data"));
	library = createLibraryModule({
		configuration: {
			settings: { resourceRoot: root },
			async update(next) {
				return next;
			},
		},
		index: new LibraryIndex(),
		logger,
	});
	playback = new PlaybackApplication({
		sources: library.sources,
		policy: builtinPolicy.playback,
		repository: database.playback,
		logger,
	});
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
		playback,
	});
	await library.startScan();
	await library.waitForCompletion();
});
afterEach(async () => {
	await app.close();
	database.close();
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});
async function open() {
	const response = await app.inject({
		method: "POST",
		url: "/api/playback/sessions",
		headers,
		payload: { fileId },
	});
	expect(response.statusCode).toBe(201);
	return response.json<PlaybackSessionResponse>();
}
function save(session: PlaybackSessionResponse, sequence = 1) {
	return app.inject({
		method: "PUT",
		url: `/api/playback/sessions/${session.token}/progress`,
		headers,
		payload: {
			generation: session.progress.generation,
			sourceVersion: session.sourceVersion,
			sequence,
			positionMs: 40000,
			durationMs: 100000,
		},
	});
}

test("HTTP open/save/list/release flow resumes progress and rejects delayed writes", async () => {
	const session = await open();
	expect(session.file.id).toBe(fileId);
	expect(session).not.toHaveProperty("plan");
	expect(session).not.toHaveProperty("generation");
	expect(session.progress.positionMs).toBe(0);
	expect(session.progress).not.toHaveProperty("sourceId");
	expect(JSON.stringify(session)).not.toContain(root);
	const saved = await save(session);
	expect(saved.statusCode).toBe(200);
	expect(saved.headers["cache-control"]).toBe("no-store");
	expect(saved.json()).toMatchObject({
		status: "saved",
		progress: { positionMs: 40000, lastSequence: 1 },
	});
	const duplicate = await save(session);
	expect(duplicate.statusCode).toBe(200);
	expect(duplicate.json().status).toBe("duplicate");
	expect(duplicate.json().progress).toEqual(saved.json().progress);
	const list = await app.inject({
		url: "/api/history?limit=1",
		headers,
	});
	expect(list.statusCode).toBe(200);
	expect(list.headers["cache-control"]).toBe("no-store");
	expect(list.json()).toMatchObject({
		availability: "checked",
		items: [{ file: { id: fileId }, progress: { positionMs: 40000 } }],
	});
	const resumed = await open();
	expect(resumed.progress.positionMs).toBe(40000);
	expect(resumed.progress).not.toHaveProperty("revision");
	expect((await save(session, 2)).statusCode).toBe(409);
	const released = await app.inject({
		method: "DELETE",
		url: `/api/playback/sessions/${resumed.token}`,
		headers,
	});
	expect(released.statusCode).toBe(204);
	expect(released.body).toBe("");
	expect(
		(
			await app.inject({
				method: "DELETE",
				url: `/api/playback/sessions/${resumed.token}`,
				headers,
			})
		).statusCode,
	).toBe(204);
	expect((await save(resumed)).statusCode).toBe(409);
});

test.each([
	{},
	{ fileId: "" },
	{ fileId: "../episode.mp4" },
	{ fileId: 1 },
	{ fileId, sourceId: "private" },
])(
	"rejects invalid session bodies without opening a session: %j",
	async (payload) => {
		const operation = vi.spyOn(playback, "open");
		const response = await app.inject({
			method: "POST",
			url: "/api/playback/sessions",
			headers,
			payload,
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("INVALID_REQUEST");
		expect(operation).not.toHaveBeenCalled();
	},
);

test.each([
	{ generation: "1" },
	{ generation: 0 },
	{ sequence: 0 },
	{ sequence: 1.5 },
	{ positionMs: -1 },
	{ positionMs: Number.MAX_SAFE_INTEGER + 1 },
	{ durationMs: 0 },
	{ durationMs: -1 },
	{ sourceVersion: "" },
	{ token: "body-token" },
	{ sourceId: "private-source" },
])("rejects invalid save bodies before the application: %j", async (extra) => {
	const session = await open();
	const operation = vi.spyOn(playback, "save");
	const response = await app.inject({
		method: "PUT",
		url: `/api/playback/sessions/${session.token}/progress`,
		headers,
		payload: {
			generation: session.progress.generation,
			sourceVersion: session.sourceVersion,
			sequence: 1,
			positionMs: 1000,
			durationMs: 100000,
			...extra,
		},
	});
	expect(response.statusCode).toBe(400);
	expect(operation).not.toHaveBeenCalled();
});

test("accepts unknown duration and backward seeks, rejects stale sequences and version mismatches", async () => {
	const session = await open();
	await save(session, 2);
	const route = `/api/playback/sessions/${session.token}/progress`;
	const body = {
		generation: session.progress.generation,
		sourceVersion: session.sourceVersion,
		sequence: 3,
		positionMs: 1000,
		durationMs: null,
	};
	const backward = await app.inject({
		method: "PUT",
		url: route,
		headers,
		payload: body,
	});
	expect(backward.statusCode).toBe(200);
	expect(backward.json().progress).toMatchObject({
		positionMs: 1000,
		durationMs: null,
	});
	expect((await save(session, 1)).statusCode).toBe(409);
	const mismatch = await app.inject({
		method: "PUT",
		url: route,
		headers,
		payload: { ...body, sequence: 4, sourceVersion: "wrong-version" },
	});
	expect(mismatch.statusCode).toBe(409);
	expect(mismatch.json().error.code).toBe("PLAYBACK_CONFLICT");
});

test.each(["0", "101", "-1", "1.5", "abc", "1&limit=2", "20&extra=1"])(
	"rejects invalid history limits: %s",
	async (query) => {
		const response = await app.inject({
			url: `/api/history?limit=${query}`,
			headers,
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("INVALID_REQUEST");
	},
);

test("rejects malformed release tokens", async () => {
	expect(
		(
			await app.inject({
				method: "DELETE",
				url: "/api/playback/sessions/not-a-token",
				headers,
			})
		).statusCode,
	).toBe(400);
});

test("checks Host and Origin on playback mutations before executing use cases", async () => {
	const session = await open();
	const operations = [
		{
			method: "POST" as const,
			url: "/api/playback/sessions",
			payload: { fileId },
		},
		{
			method: "PUT" as const,
			url: `/api/playback/sessions/${session.token}/progress`,
			payload: {
				generation: session.progress.generation,
				sourceVersion: session.sourceVersion,
				sequence: 1,
				positionMs: 1000,
				durationMs: null,
			},
		},
		{
			method: "DELETE" as const,
			url: `/api/playback/sessions/${session.token}`,
		},
	];
	for (const operation of operations) {
		expect(
			(
				await app.inject({
					...operation,
					headers: { ...headers, origin: "https://foreign.example" },
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await app.inject({
					...operation,
					headers: { ...headers, "sec-fetch-site": "cross-site" },
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await app.inject({
					...operation,
					headers: { host: "foreign.example:3000" },
				})
			).statusCode,
		).toBe(400);
	}
	expect((await save(session)).statusCode).toBe(200);
});

test("missing and replaced sources yield useful errors and disappear from history", async () => {
	const missing = await app.inject({
		method: "POST",
		url: "/api/playback/sessions",
		headers,
		payload: { fileId: "file_unknown" },
	});
	expect(missing.statusCode).toBe(404);
	const session = await open();
	await save(session);
	await writeFile(join(root, "replacement.mp4"), "replacement video");
	await rename(join(root, "replacement.mp4"), join(root, "episode.mp4"));
	expect((await save(session, 2)).statusCode).toBe(409);
	expect(
		(await app.inject({ url: "/api/history", headers })).json().items,
	).toEqual([]);
	await rm(join(root, "episode.mp4"));
	const unavailable = await app.inject({
		method: "POST",
		url: "/api/playback/sessions",
		headers,
		payload: { fileId },
	});
	expect(unavailable.statusCode).toBe(404);
	expect(unavailable.json().error.code).toBe("RESOURCE_MISSING");
});

test("failed persistence uses typed errors and hides internal causes", async () => {
	vi.spyOn(database.playback, "get").mockImplementation(() => {
		throw new Error(`private database path ${directory}`);
	});
	const response = await app.inject({
		method: "POST",
		url: "/api/playback/sessions",
		headers,
		payload: { fileId },
	});
	expect(response.statusCode).toBe(500);
	expect(response.json().error.code).toBe("PLAYBACK_PERSISTENCE_FAILED");
	expect(response.body).not.toContain(directory);
	expect(response.json().error.requestId).toBe(
		response.headers["x-request-id"],
	);
});

test("unscanned libraries return unknown availability and unavailable storage returns 503", async () => {
	await app.close();
	library = createLibraryModule({
		configuration: {
			settings: { resourceRoot: root },
			async update(next) {
				return next;
			},
		},
		index: new LibraryIndex(),
		logger,
	});
	playback = new PlaybackApplication({
		sources: library.sources,
		policy: builtinPolicy.playback,
		repository: database.playback,
		logger,
	});
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
		playback,
	});
	expect((await app.inject({ url: "/api/history", headers })).json()).toEqual({
		availability: "unknown",
		items: [],
	});
	await app.close();
	playback = new PlaybackApplication({ sources: library.sources, logger });
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		playback,
	});
	const unavailable = await app.inject({
		url: "/api/history",
		headers,
	});
	expect(unavailable.statusCode).toBe(503);
	expect(unavailable.json().error.code).toBe("PLAYBACK_UNAVAILABLE");
	expect((await app.inject({ url: "/api/health", headers })).statusCode).toBe(
		200,
	);
});

test("recent history includes completed and zero-position records, but excludes replaced files", async () => {
	const session = await open();
	for (const [sequence, positionMs] of [
		[1, 100000],
		[2, 0],
	]) {
		await app.inject({
			method: "PUT",
			url: `/api/playback/sessions/${session.token}/progress`,
			headers,
			payload: {
				generation: session.progress.generation,
				sourceVersion: session.sourceVersion,
				sequence,
				positionMs,
				durationMs: 100000,
			},
		});
		const history = await app.inject({
			method: "GET",
			url: "/api/history",
			headers,
		});
		expect(history.statusCode).toBe(200);
		expect(history.headers["cache-control"]).toBe("no-store");
		expect(history.json().items).toHaveLength(1);
		expect(history.json().items[0].progress.positionMs).toBe(positionMs);
		expect(JSON.stringify(history.json())).not.toContain(root);
	}
	await writeFile(join(root, "episode.mp4"), "replacement with different size");
	const history = await app.inject({
		method: "GET",
		url: "/api/history",
		headers,
	});
	expect(history.json().items).toEqual([]);
});

test("history without a query uses the injected application default", async () => {
	const customPlayback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		policy: {
			...builtinPolicy.playback,
			historyLimit: 1,
			maximumListLimit: 1,
		},
	});
	const customApp = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		playback: customPlayback,
	});
	try {
		const response = await customApp.inject({ url: "/api/history", headers });
		expect(response.statusCode).toBe(200);
		expect(
			(await customApp.inject({ url: "/api/history?limit=2", headers }))
				.statusCode,
		).toBe(400);
	} finally {
		await customApp.close();
	}
});
