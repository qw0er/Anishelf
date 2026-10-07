import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { MediaPlanningApplication } from "../src/modules/media-planning/application/planning.js";
import type {
	MediaExecutionRequest,
	MediaProcessingApi,
	ProcessedMedia,
} from "../src/modules/media-processing/public.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import { PreparationApplication } from "../src/modules/preparation/application/preparation.js";
import {
	InvalidPreparedMediaError,
	PreparedMediaFiles,
} from "../src/modules/preparation/infrastructure/files.js";
import { preparationPolicy } from "../src/modules/preparation/policy.js";
import { MediaToolError } from "../src/platform/media/index.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import {
	preparationStartResponse,
	preparationTaskResponse,
} from "../src/transport/presenters/preparation.js";
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
		cacheBudget?: () => number;
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
	let compatibility: MediaPlanningApplication;
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
						output: { delivery: "file", path },
						fileId: request.fileId,
						sourceVersion: request.sourceVersion,
						planId: request.plan.id,
						videoStreamIndex: request.videoStreamIndex,
						audioStreamIndices: request.audioStreamIndices,
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
		compatibility = new MediaPlanningApplication({
			sources: library.sources,
			inspection,
			profiles,
		});
		playback = new PlaybackApplication({
			sources: library.sources,
			repository: database.playback,
			logger,
		});
		preparation = new PreparationApplication({
			sources: library.sources,
			planning: compatibility,
			processing,
			repository: database.preparation,
			profiles,
			dataDir,
			logger,
			...(options.cacheBudget
				? { maximumCacheBytes: options.cacheBudget }
				: {}),
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
			mediaPlanning: compatibility,
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
		get planning() {
			return compatibility;
		},
		get application() {
			return preparation;
		},
		get preparation() {
			return {
				create: async (input: CompatibilityCheckRequest & { fileId: string }) =>
					preparationStartResponse(await preparation.create(input)),
				get: async (id: string) =>
					preparationTaskResponse(await preparation.get(id)),
				list: async (fileId?: string) => ({
					tasks: (await preparation.list(fileId)).tasks.map(
						preparationTaskResponse,
					),
				}),
				cancel: async (id: string) =>
					preparationTaskResponse(await preparation.cancel(id)),
				retry: async (id: string, input: CompatibilityCheckRequest) =>
					preparationTaskResponse(await preparation.retry(id, input)),
				openArtifact: preparation.openArtifact.bind(preparation),
				deleteArtifact: preparation.deleteArtifact.bind(preparation),
			};
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
	const snapshot = f.database.preparation.get(task.id);
	await f.restart();
	expect((await f.preparation.get(task.id)).status).toBe("ready");
	expect(f.database.preparation.get(task.id)?.spec.settings).toEqual(
		snapshot?.spec.settings,
	);
	expect(f.database.preparation.get(task.id)?.spec).toEqual(snapshot?.spec);
	expect((await f.preparation.get(task.id)).artifactId).toBe(task.artifactId);
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
			url: required(task.resource?.url),
			headers: { ...headers, range },
		});
		expect(response.statusCode).toBe(code);
		expect(response.body).toBe(body);
	}
	const head = await f.app.inject({
		method: "HEAD",
		url: required(task.resource?.url),
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
		generation: session.progress.generation,
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

test("retry replaces a legacy execution plan without changing the old task", async () => {
	const f = await fixture();
	const plan = f.planning.plan.bind(f.planning);
	vi.spyOn(f.planning, "plan").mockImplementationOnce(async (input) => {
		const planned = structuredClone(await plan(input));
		if (planned.kind !== "processing-required")
			throw new Error("Expected work");
		return {
			...planned,
			identity: { ...planned.identity, executionPlanId: "a".repeat(64) },
			execution: {
				...planned.execution,
				plan: { ...planned.execution.plan, id: "a".repeat(64) },
			},
		};
	});
	const legacy = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await f.preparation.deleteArtifact(required(legacy.artifactId));
	const original = f.database.preparation.get(legacy.id);
	const { fileId: _fileId, ...input } = await f.input();
	const response = await f.app.inject({
		method: "POST",
		url: `/api/preparations/${legacy.id}/retry`,
		headers,
		payload: input,
	});
	expect(response.statusCode).toBe(200);
	const replacement = response.json();
	expect(replacement.id).not.toBe(legacy.id);
	expect((await completed(f, replacement.id)).status).toBe("ready");
	expect(f.database.preparation.get(legacy.id)).toEqual(original);
	expect(
		f.database.preparation.get(replacement.id)?.spec.executionPlanId,
	).not.toBe(original?.spec.executionPlanId);
	// Repeating the old action reuses the current artifact, without duplicate work.
	expect((await f.preparation.retry(legacy.id, input)).id).toBe(replacement.id);
	expect(f.processing.start).toHaveBeenCalledTimes(2);
	const ready = await f.preparation.get(replacement.id);
	await f.preparation.deleteArtifact(required(ready.artifactId));
	expect((await f.preparation.retry(legacy.id, input)).id).toBe(replacement.id);
	expect((await completed(f, replacement.id)).status).toBe("ready");
	expect(f.processing.start).toHaveBeenCalledTimes(3);
	expect(f.database.preparation.get(legacy.id)).toEqual(original);
});

test("retry does not replace a task when the source version changed", async () => {
	const f = await fixture();
	const task = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	await f.preparation.deleteArtifact(required(task.artifactId));
	await writeFile(f.sourcePath, "changed source");
	const { fileId: _fileId, ...input } = await f.input();
	await expect(f.preparation.retry(task.id, input)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	expect((await f.preparation.list()).tasks).toHaveLength(1);
	expect(f.processing.start).toHaveBeenCalledTimes(1);
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
	expect((await f.preparation.get(id)).resource).toBeNull();
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
	expect(interrupted.resource).toBeNull();
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
		expect(task.resource).toBeNull();
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
	expect(pending.resource).toBeNull();
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
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
		url: required(ready.resource?.url),
		headers,
	});
	expect(deleted.statusCode).toBe(204);
	expect(
		(await f.app.inject({ url: required(ready.resource?.url), headers }))
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
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
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
	expect(pendingScan.resource).toBeNull();
	await expect(
		f.preparation.openArtifact(required(ready.artifactId)),
	).rejects.toMatchObject({ code: "PREPARATION_UNAVAILABLE" });
	snapshot.mockRestore();
	const checked = await f.preparation.get(ready.id);
	expect(checked.playbackAvailability).toBe("ready");
	expect(checked.resource?.url).toBe(ready.resource?.url);
});

test("file-filtered task lookup finds an older copy outside the global recent-task limit", async () => {
	const f = await fixture({ listLimit: 1 });
	const result = await f.preparation.create(await f.input());
	if (result.kind !== "task") throw new Error("Expected task");
	await vi.waitFor(async () =>
		expect((await f.preparation.get(result.task.id)).status).toBe("ready"),
	);
	const original = required(f.database.preparation.get(result.task.id));
	f.database.preparation.insert({
		...original,
		id: randomUUID(),
		spec: {
			...original.spec,
			source: {
				...original.spec.source,
				fileId: "another-file",
				relativePath: "another.mkv",
			},
			executionPlanId: "f".repeat(64),
		},
		state: {
			status: "failed",
			failureReason: "processing-failed",
			progress: null,
			updatedAtMs: original.state.updatedAtMs + 1,
		},
		createdAtMs: original.createdAtMs + 1,
	});
	const recent = await f.preparation.list();
	expect(recent.tasks[0]?.fileId).toBe("another-file");
	const filtered = await f.app.inject({
		method: "GET",
		url: `/api/preparations?fileId=${encodeURIComponent(original.spec.source.fileId)}`,
		headers,
	});
	expect(filtered.statusCode).toBe(200);
	expect(filtered.json().tasks[0]).toMatchObject({
		id: original.id,
		status: "ready",
		playbackAvailability: "ready",
	});
	const batch = await f.app.inject({
		method: "POST",
		url: "/api/preparations/summaries",
		headers,
		payload: { fileIds: [original.spec.source.fileId] },
	});
	expect(batch.json().files[0].versions).toEqual([
		{
			sourceVersion: original.spec.source.sourceVersion,
			publishedCopies: 1,
			pendingTasks: 0,
		},
	]);
	const invalid = await f.app.inject({
		method: "GET",
		url: "/api/preparations?fileId=bad/path",
		headers,
	});
	expect(invalid.statusCode).toBe(400);
});

test.each([1, null])(
	"migrates persisted single audio selection %s before listing tasks",
	async (audioIndex) => {
		const f = await fixture();
		const id = await taskId(f.preparation.create(await f.input()));
		const task = await completed(f, id);
		const artifactPath = join(
			f.dataDir,
			"cache",
			"prepared-media",
			`${task.artifactId}.media`,
		);
		const originalBytes = await readFile(artifactPath);
		const originalSpec = f.database.preparation.get(id)?.spec;
		const writer = await f.playback.open(task.fileId);
		await f.playback.save({
			token: writer.token,
			generation: writer.progress.generation,
			sourceVersion: writer.sourceVersion,
			sequence: 1,
			positionMs: 1000,
			durationMs: 10000,
		});
		const connection = new Database(join(f.dataDir, "anishelf.sqlite"));
		try {
			connection
				.prepare(`UPDATE preparation_tasks SET snapshot = json_remove(
			json_set(json_object('request',json_object('fileId',?,'sourceVersion',?,'videoStreamIndex',json_extract(snapshot,'$.videoStreamIndex'),'plan',json_set(json_extract(snapshot,'$.plan'),'$.id',execution_plan_id)),
 'identity',json_object('executionPlanId',execution_plan_id),'mode',json_extract(snapshot,'$.mode'),'reasons',json_extract(snapshot,'$.reasons')), '$.request.audioStreamIndex', json(?), '$.identity.audioStreamIndex', json(?)),
			'$.request.audioStreamIndices', '$.identity.audioStreamIndices') WHERE id = ?`)
				.run(
					task.fileId,
					task.sourceVersion,
					JSON.stringify(audioIndex),
					JSON.stringify(audioIndex),
					id,
				);
			connection
				.prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
				.run(1791207000000);
		} finally {
			connection.close();
		}
		await f.restart();
		const expected = audioIndex === null ? [] : [audioIndex];
		const response = await f.app.inject({
			method: "GET",
			url: "/api/preparations",
			headers,
		});
		expect(response.statusCode, response.body).toBe(200);
		expect(response.json().tasks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id,
					audioStreamIndices: expected,
					artifactId: task.artifactId,
				}),
			]),
		);
		expect(
			f.database.preparation.get(id)?.spec.settings.audioStreamIndices,
		).toEqual(expected);
		await f.restart();
		expect((await f.preparation.get(id)).audioStreamIndices).toEqual(expected);
		expect(await readFile(artifactPath)).toEqual(originalBytes);
		const upgraded = f.database.preparation.get(id);
		expect(upgraded?.spec.executionPlanId).toBe(originalSpec?.executionPlanId);
		expect(upgraded?.spec.profileFingerprint).toBe(
			originalSpec?.profileFingerprint,
		);
		expect(upgraded?.spec.settings.version).toBe(1);
		const reopened = await f.playback.open(task.fileId);
		expect(reopened.progress.generation).toBeGreaterThan(
			writer.progress.generation,
		);
		expect(reopened.progress).toMatchObject({
			positionMs: 1000,
			lastSequence: 0,
		});
		expect((await f.playback.history()).items[0]?.file.id).toBe(task.fileId);
		const borrowed = await f.preparation.openArtifact(
			required(task.artifactId),
		);
		await borrowed.handle.close();
		borrowed.release();
	},
);

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("slow planning does not block unrelated reads or queued cancellation", async () => {
	const f = await fixture({ beforeOutput: waitForAbort });
	const active = await taskId(f.preparation.create(await f.input()));
	await vi.waitFor(async () =>
		expect((await f.preparation.get(active)).status).toBe("processing"),
	);
	const next = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	const gate = barrier();
	const entered = barrier();
	const original = f.planning.plan.bind(f.planning);
	vi.spyOn(f.planning, "plan").mockImplementationOnce(async (input) => {
		entered.resolve();
		await gate.promise;
		return original(input);
	});
	const slow = f.preparation.create(await f.input());
	try {
		await entered.promise;
		expect((await f.preparation.get(active)).status).toBe("processing");
		expect((await f.preparation.cancel(next)).status).toBe("cancelled");
	} finally {
		gate.resolve();
		await slow;
		await f.preparation.cancel(active);
	}
});

test("a slow ready-file validation does not block cancellation of another task", async () => {
	let block = false;
	const f = await fixture({
		beforeOutput: (request) =>
			block ? waitForAbort(request) : Promise.resolve(),
	});
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	block = true;
	const active = await taskId(
		f.preparation.create(await f.input({ "copy-audio": "unsupported" })),
	);
	await vi.waitFor(async () =>
		expect((await f.preparation.get(active)).status).toBe("processing"),
	);
	const gate = barrier();
	const entered = barrier();
	const original = PreparedMediaFiles.prototype.open;
	vi.spyOn(PreparedMediaFiles.prototype, "open").mockImplementationOnce(
		async function (this: PreparedMediaFiles, artifact) {
			entered.resolve();
			await gate.promise;
			return original.call(this, artifact);
		},
	);
	const validation = f.preparation.get(ready.id);
	try {
		await entered.promise;
		expect((await f.preparation.cancel(active)).status).toBe("cancelled");
	} finally {
		gate.resolve();
		await validation;
	}
});

test("cancellation is visible during publication and only finishes after temporary cleanup", async () => {
	const f = await fixture();
	const publication = barrier();
	const entered = barrier();
	const release = barrier();
	const releasing = barrier();
	const originalPublish = PreparedMediaFiles.prototype.publish;
	vi.spyOn(PreparedMediaFiles.prototype, "publish").mockImplementationOnce(
		async function (this: PreparedMediaFiles, id, path, size) {
			entered.resolve();
			await publication.promise;
			return originalPublish.call(this, id, path, size);
		},
	);
	const originalRelease = f.processing.release.bind(f.processing);
	vi.spyOn(f.processing, "release").mockImplementationOnce(async (id) => {
		releasing.resolve();
		await release.promise;
		await originalRelease(id);
	});
	const id = await taskId(f.preparation.create(await f.input()));
	await entered.promise;
	let settled = false;
	const cancelling = f.preparation.cancel(id).then((value) => {
		settled = true;
		return value;
	});
	try {
		await vi.waitFor(async () =>
			expect((await f.preparation.get(id)).status).toBe("cancelling"),
		);
		expect(settled).toBe(false);
		const fresh = await f.input();
		const { fileId: _fileId, ...retry } = fresh;
		await expect(f.preparation.retry(id, retry)).rejects.toMatchObject({
			code: "PREPARATION_BUSY",
		});
		publication.resolve();
		await releasing.promise;
		expect((await f.preparation.get(id)).status).toBe("cancelling");
		expect(settled).toBe(false);
	} finally {
		publication.resolve();
		release.resolve();
	}
	expect((await cancelling).status).toBe("cancelled");
	expect(f.database.preparation.artifacts()).toEqual([]);
	const key = required(f.database.preparation.get(id)).spec.executionPlanId;
	await expect(
		readFile(join(f.dataDir, "cache", "prepared-media", `${key}.media`)),
	).rejects.toMatchObject({ code: "ENOENT" });
	const row = required(f.database.preparation.get(id));
	expect(row.state.status).toBe("cancelled");
	expect(await f.application.get(id)).not.toHaveProperty("resource");
});

test("query telemetry is projected and immutable specifications are not rewritten by progress", async () => {
	const f = await fixture();
	const id = await taskId(f.preparation.create(await f.input()));
	const ready = await completed(f, id);
	expect(ready.progress).toEqual({ percent: 100, mediaTimeMs: 2000, speed: 1 });
	const task = required(f.database.preparation.get(id));
	expect(Object.isFrozen(task.spec.settings)).toBe(true);
	expect(task.spec.settings.plan).not.toHaveProperty("id");
	expect(task.spec.settings).not.toHaveProperty("request");
	expect(task.spec.settings).not.toHaveProperty("identity");
	expect(task.spec.settings).not.toHaveProperty("sourceVersion");
	expect(task.state.progress).toHaveProperty("outputBytes", 10);
	const raw = new Database(join(f.dataDir, "anishelf.sqlite"));
	try {
		expect(raw.pragma("foreign_key_check")).toEqual([]);
	} finally {
		raw.close();
	}
});

test("invalidated borrowers prevent replacing the same artifact until all handles release", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const one = await f.preparation.openArtifact(required(ready.artifactId));
	const two = await f.preparation.openArtifact(required(ready.artifactId));
	vi.spyOn(PreparedMediaFiles.prototype, "open").mockRejectedValueOnce(
		new InvalidPreparedMediaError(),
	);
	expect((await f.preparation.get(ready.id)).failureReason).toBe(
		"cache-missing",
	);
	const { fileId: _fileId, ...input } = await f.input();
	await expect(f.preparation.retry(ready.id, input)).rejects.toMatchObject({
		code: "PREPARATION_BUSY",
	});
	await one.release();
	await one.release();
	await expect(f.preparation.retry(ready.id, input)).rejects.toMatchObject({
		code: "PREPARATION_BUSY",
	});
	await two.release();
	await f.preparation.retry(ready.id, input);
	expect((await completed(f, ready.id)).status).toBe("ready");
});

test("worker admission and scheduling never scan the whole task list", async () => {
	const f = await fixture();
	vi.spyOn(f.database.preparation, "list").mockImplementation(() => {
		throw new Error("Unexpected full task scan");
	});
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).status).toBe("ready");
});

test("cleanup failure never acknowledges cancellation and recovery marks it interrupted", async () => {
	const f = await fixture();
	const gate = barrier();
	const entered = barrier();
	vi.spyOn(PreparedMediaFiles.prototype, "publish").mockImplementationOnce(
		async () => {
			entered.resolve();
			await gate.promise;
			throw new Error("Publication stopped");
		},
	);
	const release = vi
		.spyOn(f.processing, "release")
		.mockRejectedValueOnce(new Error("Cleanup failed"));
	const id = await taskId(f.preparation.create(await f.input()));
	await entered.promise;
	const cancelled = f.preparation.cancel(id);
	const rejection = expect(cancelled).rejects.toThrow("Cleanup failed");
	try {
		await vi.waitFor(async () =>
			expect((await f.preparation.get(id)).status).toBe("cancelling"),
		);
	} finally {
		gate.resolve();
	}
	await rejection;
	expect((await f.preparation.get(id)).status).toBe("cancelling");
	await expect(f.preparation.create(await f.input())).rejects.toMatchObject({
		code: "PREPARATION_UNAVAILABLE",
	});
	release.mockRestore();
	await f.restart();
	expect((await f.preparation.get(id)).failureReason).toBe("interrupted");
	const { fileId: _fileId, ...input } = await f.input();
	await f.preparation.retry(id, input);
	expect((await completed(f, id)).status).toBe("ready");
});

test("directory summaries include old publications without validating source or artifact bytes", async () => {
	const f = await fixture({ listLimit: 1 });
	const id = await taskId(f.preparation.create(await f.input()));
	const ready = await completed(f, id);
	const fileId = ready.fileId;
	const resolve = vi.spyOn(f.library.sources, "resolveSource");
	const revalidate = vi.spyOn(f.library.sources, "revalidateSource");
	const artifact = vi.spyOn(PreparedMediaFiles.prototype, "open");
	const response = await f.app.inject({
		method: "POST",
		url: "/api/preparations/summaries",
		headers,
		payload: { fileIds: [fileId] },
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		files: [
			{
				fileId,
				versions: [
					{
						sourceVersion: ready.sourceVersion,
						publishedCopies: 1,
						pendingTasks: 0,
					},
				],
			},
		],
	});
	expect(resolve).not.toHaveBeenCalled();
	expect(revalidate).not.toHaveBeenCalled();
	expect(artifact).not.toHaveBeenCalled();
	await rm(
		join(f.dataDir, "cache", "prepared-media", `${ready.artifactId}.media`),
	);
	const summary = await f.app.inject({
		url: "/api/preparations?summary=true",
		headers,
	});
	expect(summary.statusCode).toBe(200);
	expect(summary.json().tasks[0]).toMatchObject({
		id,
		status: "ready",
		resource: null,
		playbackAvailability: "unknown",
		artifactId: ready.artifactId,
	});
	expect(artifact).not.toHaveBeenCalled();
	expect((await f.preparation.get(id)).failureReason).toBe("cache-missing");
});

test("summary transport rejects duplicate or oversized file batches", async () => {
	const f = await fixture();
	for (const fileIds of [
		["root", "root"],
		Array.from({ length: 501 }, (_, index) => `file-${index}`),
	]) {
		const response = await f.app.inject({
			method: "POST",
			url: "/api/preparations/summaries",
			headers,
			payload: { fileIds },
		});
		expect(response.statusCode).toBe(400);
	}
});

test("summaries separate source versions and filter the current profile and root", async () => {
	const f = await fixture();
	const ready = await completed(
		f,
		await taskId(f.preparation.create(await f.input())),
	);
	const task = required(f.database.preparation.get(ready.id));
	f.database.preparation.insert({
		...task,
		id: randomUUID(),
		spec: {
			...task.spec,
			executionPlanId: "b".repeat(64),
			source: { ...task.spec.source, sourceVersion: "b".repeat(64) },
		},
		state: {
			status: "processing",
			progress: null,
			failureReason: null,
			updatedAtMs: Date.now(),
		},
	});
	const result = await f.application.summaries([ready.fileId]);
	expect(result.files[0]?.versions).toEqual(
		expect.arrayContaining([
			{
				sourceVersion: ready.sourceVersion,
				publishedCopies: 1,
				pendingTasks: 0,
			},
			{ sourceVersion: "b".repeat(64), publishedCopies: 0, pendingTasks: 1 },
		]),
	);
	const profile = required(
		f.profiles.find((profile) => profile.id === task.profileId),
	);
	profile.copyCompatibleStreams = !profile.copyCompatibleStreams;
	expect(
		(await f.application.summaries([ready.fileId])).files[0]?.versions,
	).toEqual([]);
	const otherRoot = join(f.dataDir, "other-root");
	await mkdir(otherRoot, { recursive: true });
	await f.library.updateSettings({ resourceRoot: otherRoot });
	expect(
		(await f.application.summaries([ready.fileId])).files[0]?.versions,
	).toEqual([]);
});

test("task list defaults to ten records and More expands to one hundred", async () => {
	const f = await fixture();
	const id = await taskId(f.preparation.create(await f.input()));
	await completed(f, id);
	const original = required(f.database.preparation.get(id));
	for (let index = 1; index <= 105; index++)
		f.database.preparation.insert({
			...original,
			id: randomUUID(),
			spec: {
				...original.spec,
				executionPlanId: index.toString(16).padStart(64, "0"),
			},
			state: {
				status: "cancelled",
				failureReason: "cancelled",
				progress: null,
				updatedAtMs: original.createdAtMs + index,
			},
			createdAtMs: original.createdAtMs + index,
		});
	const initial = await f.app.inject({
		url: "/api/preparations?summary=true",
		headers,
	});
	expect(initial.statusCode).toBe(200);
	expect(initial.json().tasks).toHaveLength(10);
	const expanded = await f.app.inject({
		url: "/api/preparations?summary=true&more=true",
		headers,
	});
	expect(expanded.statusCode).toBe(200);
	expect(expanded.json().tasks).toHaveLength(100);
	expect(expanded.json().tasks.slice(0, 10)).toEqual(initial.json().tasks);
});

test("new preparation attempts read the updated cache budget", async () => {
	let budget = 10;
	const f = await fixture({ cacheBudget: () => budget });
	const id = await taskId(f.preparation.create(await f.input()));
	expect((await completed(f, id)).failureReason).toBe("cache-full");
	budget = 100;
	const { fileId: _fileId, ...retry } = await f.input();
	await f.preparation.retry(id, retry);
	expect((await completed(f, id)).status).toBe("ready");
	expect(vi.mocked(f.processing.start).mock.calls[1]?.[0].maximumBytes).toBe(
		100,
	);
});
