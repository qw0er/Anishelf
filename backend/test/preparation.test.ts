import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type {
	CompatibilityCheckRequest,
	PreparationStartResponse,
} from "../src/contracts/http.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../src/modules/media-compatibility/public.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import type {
	MediaExecutionRequest,
	MediaProcessingApi,
	ProcessedMedia,
} from "../src/modules/media-processing/public.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import {
	PreparationApplication,
	preparationPolicy,
} from "../src/modules/preparation/public.js";
import { MediaToolError } from "../src/platform/media/index.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { settingsStore } from "./settings-store.js";

const cleanup: Array<() => Promise<unknown>> = [];
const logger = pino({ enabled: false });
const headers = { host: "127.0.0.1:3000" };
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

async function fixture(
	options: {
		beforeOutput?: (request: MediaExecutionRequest) => Promise<void>;
		maximumCacheBytes?: number;
		minimumFreeBytes?: number;
		maximumQueuedTasks?: number;
		listLimit?: number;
	} = {},
) {
	const root = await mkdtemp(join(tmpdir(), "anishelf-preparation-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	const media = join(root, "media");
	const dataDir = join(root, "data");
	await mkdir(media);
	const sourcePath = join(media, "测试 $(literal).mkv");
	await writeFile(sourcePath, "source");
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(media),
		logger,
	});
	await library.startScan();
	await library.waitForCompletion();
	cleanup.push(() => library.close());
	const file = required(
		[...index.snapshot.entriesById.values()].find(
			(entry) => entry.kind === "file",
		),
	);
	const info = parseMediaInfo(
		JSON.stringify({
			format: { format_name: "matroska", duration: "2" },
			streams: [
				{
					index: 0,
					codec_type: "video",
					codec_name: "h264",
					width: 160,
					height: 90,
					avg_frame_rate: "24/1",
					pix_fmt: "yuv420p",
				},
				{ index: 1, codec_type: "audio", codec_name: "aac", channels: 2 },
			],
		}),
		"matroska",
	);
	required(info.streams[0]).codecString = "avc1.640028";
	required(info.streams[1]).codecString = "mp4a.40.2";
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe: vi.fn().mockResolvedValue(info) },
	});
	cleanup.push(() => inspection.close());
	const profiles = structuredClone(
		builtinTranscodeProfiles,
	) as TranscodeProfile[];
	const compatibility = new MediaCompatibilityApplication({
		sources: library.sources,
		inspection,
		profiles,
	});
	let database = ApplicationDatabase.open(dataDir);
	cleanup.push(async () => database.close());
	const outputs = new Map<string, string>();
	const scratch = join(dataDir, "cache", "media-processing");
	const processing: MediaProcessingApi = {
		initialize: vi.fn(async () => {
			await rm(scratch, { recursive: true, force: true });
			await mkdir(scratch, { recursive: true });
		}),
		start: vi.fn((request: MediaExecutionRequest) => {
			const id = randomUUID();
			const completion = Promise.resolve().then(
				async (): Promise<ProcessedMedia> => {
					await options.beforeOutput?.(request);
					request.signal?.throwIfAborted();
					const path = join(scratch, id);
					await writeFile(path, "0123456789");
					outputs.set(id, path);
					request.onEvent?.({
						type: "progress",
						progress: {
							percent: 100,
							mediaTimeMs: 2000,
							frames: 48,
							outputBytes: 10,
							speed: 1,
							ended: true,
						},
					});
					return {
						id,
						path,
						fileId: request.fileId,
						sourceVersion: request.sourceVersion,
						planId: request.plan.id,
						videoStreamIndex: request.videoStreamIndex,
						audioStreamIndex: request.audioStreamIndex,
						sizeBytes: 10,
						info,
					};
				},
			);
			return {
				id,
				state: "running" as const,
				completion,
				stop: async () => {
					await completion.catch(() => {});
				},
			};
		}),
		release: vi.fn(async (id) => {
			const path = outputs.get(id);
			if (path) await rm(path, { force: true });
			outputs.delete(id);
		}),
	};
	let playback: PlaybackApplication;
	let preparation: PreparationApplication;
	let app: ReturnType<typeof createHttpApp>;
	async function start() {
		playback = new PlaybackApplication({
			sources: library.sources,
			compatibility,
			repository: database.playback,
			logger,
		});
		preparation = new PreparationApplication({
			sources: library.sources,
			planning: playback,
			processing,
			repository: database.preparation,
			profiles,
			dataDir,
			logger,
			policy: {
				...preparationPolicy,
				listLimit: options.listLimit ?? preparationPolicy.listLimit,
				maximumCacheBytes:
					options.maximumCacheBytes ?? preparationPolicy.maximumCacheBytes,
				minimumFreeBytes:
					options.minimumFreeBytes ?? preparationPolicy.minimumFreeBytes,
				maximumQueuedTasks:
					options.maximumQueuedTasks ?? preparationPolicy.maximumQueuedTasks,
			},
		});
		await preparation.initialize();
		app = createHttpApp({
			config: { host: "127.0.0.1", port: 3000 },
			logger,
			preparation,
			compatibility,
		});
	}
	await start();
	cleanup.push(async () => {
		await app.close();
		playback.close();
	});
	async function input(
		overrides: Record<string, "supported" | "unsupported" | "unknown"> = {},
	): Promise<CompatibilityCheckRequest & { fileId: string }> {
		const source = await library.sources.resolveSource(file.id);
		const description = await compatibility.inspect({
			fileId: file.id,
			sourceVersion: source.identity.sourceVersion,
			output: { profileId: required(profiles[0]).id, target: "file" },
		});
		return {
			fileId: file.id,
			sourceVersion: description.sourceVersion,
			descriptionId: description.descriptionId,
			output: { profileId: required(profiles[0]).id, target: "file" },
			evidence: description.queries.map((query) => {
				const status =
					overrides[query.id] ??
					(query.id.startsWith("original") ? "unsupported" : "supported");
				return {
					id: query.id,
					status,
					reason:
						status === "supported"
							? "browser-supported"
							: status === "unsupported"
								? "browser-rejected"
								: "browser-uncertain",
					smooth: null,
					powerEfficient: null,
				};
			}),
		};
	}
	return {
		input,
		sourcePath,
		dataDir,
		library,
		profiles,
		processing,
		get database() {
			return database;
		},
		get preparation() {
			return preparation;
		},
		get playback() {
			return playback;
		},
		get app() {
			return app;
		},
		async restart() {
			await app.close();
			playback.close();
			database.close();
			database = ApplicationDatabase.open(dataDir);
			await start();
		},
	};
}
async function taskId(response: Promise<PreparationStartResponse>) {
	const result = await response;
	if (result.kind !== "task") throw new Error(`Unexpected ${result.kind}`);
	return result.task.id;
}
async function completed(f: Awaited<ReturnType<typeof fixture>>, id: string) {
	await vi.waitFor(async () => {
		expect((await f.preparation.get(id)).status).not.toMatch(
			/queued|processing/,
		);
	});
	return f.preparation.get(id);
}
function waitForAbort(request: MediaExecutionRequest): Promise<void> {
	return new Promise((_resolve, reject) => {
		if (request.signal?.aborted) reject(request.signal.reason);
		else
			request.signal?.addEventListener(
				"abort",
				() => reject(request.signal?.reason),
				{ once: true },
			);
	});
}

test("deduplicates concurrent preparation, publishes ready files, and reuses them after restart", async () => {
	const f = await fixture();
	const input = await f.input();
	const ids = await Promise.all(
		Array.from({ length: 4 }, () => taskId(f.preparation.create(input))),
	);
	expect(new Set(ids).size).toBe(1);
	const task = await completed(f, required(ids[0]));
	expect(task.status).toBe("ready");
	expect(task.progress?.percent).toBe(100);
	expect(JSON.stringify(task)).not.toContain(f.dataDir);
	expect(task).not.toHaveProperty("request");
	expect(f.processing.start).toHaveBeenCalledTimes(1);
	await f.restart();
	expect((await f.preparation.get(task.id)).status).toBe("ready");
	expect(await taskId(f.preparation.create(await f.input()))).toBe(task.id);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
	const file = await f.preparation.openArtifact(required(task.artifactId));
	expect((await file.handle.readFile()).toString()).toBe("0123456789");
	await file.release();
});

test("HTTP only delivers completed media, supports ranges/HEAD, rejects arbitrary execution fields", async () => {
	const f = await fixture();
	const { fileId, ...input } = await f.input();
	const start = await f.app.inject({
		method: "POST",
		url: `/api/files/${fileId}/preparations`,
		headers,
		payload: input,
	});
	expect(start.statusCode).toBe(200);
	const result = start.json<PreparationStartResponse>();
	if (result.kind !== "task") throw new Error("Missing task");
	const task = await completed(f, result.task.id);
	for (const [range, code, body] of [
		["bytes=2-5", 206, "2345"],
		["bytes=-3", 206, "789"],
		["bytes=20-", 416, ""],
		["invalid", 200, "0123456789"],
	] as const) {
		const response = await f.app.inject({
			url: required(task.playbackUrl),
			headers: { ...headers, range },
		});
		expect(response.statusCode).toBe(code);
		expect(response.body).toBe(body);
	}
	const head = await f.app.inject({
		method: "HEAD",
		url: required(task.playbackUrl),
		headers,
	});
	expect(head.statusCode).toBe(200);
	expect(head.headers["content-type"]).toBe("video/mp4");
	expect(head.headers["content-length"]).toBe("10");
	expect(head.body).toBe("");
	const status = await f.app.inject({
		url: `/api/preparations/${task.id}`,
		headers,
	});
	expect(status.json().status).toBe("ready");
	expect(JSON.stringify(status.json())).not.toContain("canonicalRoot");
	expect(
		(
			await f.app.inject({
				method: "POST",
				url: `/api/files/${fileId}/preparations`,
				headers,
				payload: { ...input, arguments: ["-anything"] },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await f.app.inject({
				url: "/api/prepared-media/not-a-fingerprint",
				headers,
			})
		).statusCode,
	).toBe(400);
});

test("pins borrowed artifacts and deleting cache preserves original media and durable progress", async () => {
	const f = await fixture();
	const input = await f.input();
	const session = await f.playback.open(input.fileId);
	await f.playback.save({
		token: session.token,
		generation: session.generation,
		sourceVersion: session.sourceVersion,
		sequence: 1,
		positionMs: 1000,
		durationMs: 2000,
	});
	const task = await completed(f, await taskId(f.preparation.create(input)));
	const file = await f.preparation.openArtifact(required(task.artifactId));
	await expect(
		f.preparation.deleteArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "PREPARATION_BUSY" });
	await file.release();
	await file.release();
	await f.preparation.deleteArtifact(required(task.artifactId));
	expect((await f.preparation.get(task.id)).failureReason).toBe(
		"cache-deleted",
	);
	await expect(
		f.preparation.openArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	expect((await readFile(f.sourcePath)).toString()).toBe("source");
	expect(f.database.playback.get(session.progress.sourceId)?.positionMs).toBe(
		1000,
	);
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(task.id, retry);
	expect((await completed(f, task.id)).status).toBe("ready");
});

test("queued work shares bounded capacity and cancellation waits for cleanup before retry", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
		maximumQueuedTasks: 1,
	});
	const input = await f.input();
	const id = await taskId(f.preparation.create(input));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	const next = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	expect((await f.preparation.get(next)).status).toBe("queued");
	await expect(
		f.preparation.create(await f.input({ "copy-video": "unsupported" })),
	).rejects.toMatchObject({ code: "PREPARATION_BUSY" });
	expect((await f.preparation.cancel(next)).status).toBe("cancelled");
	expect((await f.preparation.cancel(id)).status).toBe("cancelled");
	expect((await f.preparation.get(id)).playbackUrl).toBeNull();
	blocked = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
});

test("restart marks interrupted jobs retryable and cleans incomplete output", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
	});
	const id = await taskId(f.preparation.create(await f.input()));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	await writeFile(
		join(f.dataDir, "cache", "prepared-media", "orphan.pending"),
		"partial",
	);
	await f.restart();
	const interrupted = await f.preparation.get(id);
	expect(interrupted.status).toBe("failed");
	expect(interrupted.failureReason).toBe("interrupted");
	expect(interrupted.playbackUrl).toBeNull();
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", "orphan.pending")),
	).rejects.toMatchObject({ code: "ENOENT" });
	blocked = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
});

test("source replacement and changed profile invalidate derived media without changing history", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await writeFile(f.sourcePath, "replaced source with a different version");
	expect((await f.preparation.get(task.id)).failureReason).toBe(
		"source-changed",
	);
	await expect(
		f.preparation.openArtifact(required(task.artifactId)),
	).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	const fresh = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	required(f.profiles[0]).video.maxHeight = 720;
	await f.restart();
	expect((await f.preparation.get(fresh.id)).failureReason).toBe(
		"profile-changed",
	);
});

test.each([
	[10, undefined, "cache-full"],
	[undefined, Number.MAX_SAFE_INTEGER, "storage-full"],
] as const)(
	"storage limits fail safely (%s, %s)",
	async (maximumCacheBytes, minimumFreeBytes, reason) => {
		const f = await fixture({
			...(maximumCacheBytes === undefined ? {} : { maximumCacheBytes }),
			...(minimumFreeBytes === undefined ? {} : { minimumFreeBytes }),
		});
		const task = await completed(
			f,
			await taskId(f.preparation.create(await f.input())),
		);
		expect(task.status).toBe("failed");
		expect(task.failureReason).toBe(reason);
		expect(task.playbackUrl).toBeNull();
		expect(f.database.preparation.artifacts()).toHaveLength(0);
	},
);

test("processing failures remain retryable; missing completed files cannot be served", async () => {
	let fail = true;
	const f = await fixture({
		beforeOutput: async () => {
			if (fail)
				throw new MediaToolError(
					"TOOL_UNAVAILABLE",
					"Unavailable fixture tool",
				);
		},
	});
	const id = await taskId(f.preparation.create(await f.input()));
	const failed = await completed(f, id);
	expect(failed.failureReason).toBe("tool-unavailable");
	fail = false;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	const ready = await completed(f, id);
	await rm(
		join(f.dataDir, "cache", "prepared-media", `${ready.artifactId}.media`),
	);
	await f.restart();
	expect((await f.preparation.get(id)).failureReason).toBe("cache-missing");
});

test("HTTP cancellation, retry and deletion never expose a pending file", async () => {
	let blocked = true;
	const f = await fixture({
		beforeOutput: async (request) => {
			if (blocked) await waitForAbort(request);
		},
	});
	const { fileId, ...payload } = await f.input();
	const started = await f.app.inject({
		method: "POST",
		url: `/api/files/${fileId}/preparations`,
		headers,
		payload,
	});
	const id = started.json().task.id as string;
	await vi.waitFor(async () =>
		expect((await f.preparation.get(id)).status).toBe("processing"),
	);
	const pending = await f.preparation.get(id);
	expect(pending.playbackUrl).toBeNull();
	const key = required(f.database.preparation.get(id)).identity.executionPlanId;
	expect(
		(await f.app.inject({ url: `/api/prepared-media/${key}`, headers }))
			.statusCode,
	).toBe(404);
	const cancelled = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${id}/cancel`,
		headers,
		payload: {},
	});
	expect(cancelled.statusCode).toBe(200);
	expect(cancelled.json().status).toBe("cancelled");
	blocked = false;
	const retried = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${id}/retry`,
		headers,
		payload,
	});
	expect(retried.statusCode).toBe(200);
	const ready = await completed(f, id);
	const list = await f.app.inject({ url: "/api/preparations", headers });
	expect(list.json().tasks[0].id).toBe(id);
	const deleted = await f.app.inject({
		method: "DELETE",
		url: required(ready.playbackUrl),
		headers,
	});
	expect(deleted.statusCode).toBe(204);
	expect(
		(await f.app.inject({ url: required(ready.playbackUrl), headers }))
			.statusCode,
	).toBe(404);
});

test("publication failure cleans the file without making a ready artifact", async () => {
	const f = await fixture();
	vi.spyOn(f.database.preparation, "publish").mockImplementationOnce(() => {
		throw new Error("Publication database failure");
	});
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).status).toBe("failed");
	const key = required(f.database.preparation.get(id)).identity.executionPlanId;
	expect(f.database.preparation.artifacts()).toHaveLength(0);
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", `${key}.media`)),
	).rejects.toMatchObject({ code: "ENOENT" });
});

test("invalidated borrowed bytes still count against the cache budget", async () => {
	const f = await fixture({ maximumCacheBytes: 20 });
	const first = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const borrowed = await f.preparation.openArtifact(required(first.artifactId));
	await writeFile(f.sourcePath, "replaced source");
	expect((await f.preparation.get(first.id)).failureReason).toBe(
		"source-changed",
	);
	const secondId = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, secondId)).failureReason).toBe("cache-full");
	expect(vi.mocked(f.processing.start).mock.calls[1]?.[0].maximumBytes).toBe(
		10,
	);
	await borrowed.release();
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(secondId, retry);
	expect((await completed(f, secondId)).status).toBe("ready");
});

test("an unavailable startup index does not invalidate a reusable completed copy", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const snapshot = vi
		.spyOn(f.library.sources, "hasSnapshot", "get")
		.mockReturnValue(false);
	await f.restart();
	const pendingScan = await f.preparation.get(ready.id);
	expect(pendingScan.status).toBe("ready");
	expect(pendingScan.playbackAvailability).toBe("unknown");
	expect(pendingScan.playbackUrl).toBeNull();
	await expect(
		f.preparation.openArtifact(required(ready.artifactId)),
	).rejects.toMatchObject({ code: "PREPARATION_UNAVAILABLE" });
	snapshot.mockRestore();
	const checked = await f.preparation.get(ready.id);
	expect(checked.playbackAvailability).toBe("ready");
	expect(checked.playbackUrl).toBe(ready.playbackUrl);
});

test("file-filtered task lookup finds an older copy outside the global recent-task limit", async () => {
	const f = await fixture({ listLimit: 1 });
	const result = await f.preparation.create(await f.input());
	if (result.kind !== "task") throw new Error("Expected task");
	await vi.waitFor(async () =>
		expect((await f.preparation.get(result.task.id)).status).toBe("ready"),
	);
	const original = required(f.database.preparation.get(result.task.id));
	f.database.preparation.save({
		...original,
		id: randomUUID(),
		source: {
			...original.source,
			fileId: "another-file",
			relativePath: "another.mkv",
		},
		identity: {
			...original.identity,
			fileId: "another-file",
			executionPlanId: "f".repeat(64),
		},
		request: { ...original.request, fileId: "another-file" },
		status: "failed",
		createdAtMs: original.createdAtMs + 1,
		updatedAtMs: original.updatedAtMs + 1,
	});
	const recent = await f.preparation.list();
	expect(recent.tasks[0]?.fileId).toBe("another-file");
	const filtered = await f.app.inject({
		method: "GET",
		url: `/api/preparations?fileId=${encodeURIComponent(original.source.fileId)}`,
		headers,
	});
	expect(filtered.statusCode).toBe(200);
	expect(filtered.json().tasks[0]).toMatchObject({
		id: original.id,
		status: "ready",
		playbackAvailability: "ready",
	});
	const invalid = await f.app.inject({
		method: "GET",
		url: "/api/preparations?fileId=bad/path",
		headers,
	});
	expect(invalid.statusCode).toBe(400);
});
