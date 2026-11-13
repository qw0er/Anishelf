import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PreparationRequest,
	PreparationStartResponse,
} from "@anishelf/contracts/http";
import pino from "pino";
import { afterEach, expect, vi } from "vitest";
import { ApplicationDatabase } from "../../../../../src/app/bootstrap/database.js";
import { MediaInspectionApplication } from "../../../../../src/modules/media/inspection/application.js";
import type { PreparationApplication } from "../../../../../src/modules/media/preparation/application/preparation.js";
import { createPreparationApplication } from "../../../../../src/modules/media/preparation/create.js";
import type {
	MediaExecutionRequest,
	MediaProcessingApi,
	ProcessedMedia,
} from "../../../../../src/modules/media/preparation/execution/public.js";
import {
	preparationStartResponse,
	preparationTaskResponse,
} from "../../../../../src/modules/media/preparation/http/presenters.js";
import { MediaPlanningApplication } from "../../../../../src/modules/media/preparation/planning/application/planning.js";
import { preparationPolicy } from "../../../../../src/modules/media/preparation/policy.js";
import { PlaybackApplication } from "../../../../../src/modules/playback/progress/application/playback.js";
import { LibraryIndex } from "../../../../../src/modules/resources/library/infrastructure/index.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../../../../../src/modules/system/configuration/public.js";
import { parseMediaInfo } from "../../../../../src/platform/media/tools.js";
import { createHttpApp } from "../../../../support/http.js";
import { MemoryInspectionStore } from "../../../../support/inspection-store.js";
import { createLibraryModule } from "../../../../support/library.js";
import { settingsStore } from "../../../../support/settings-store.js";

export const cleanup: Array<() => Promise<unknown>> = [];

export const logger = pino({ enabled: false });

export const headers = { host: "127.0.0.1:3000" };

export function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

export async function fixture(
	options: {
		beforeOutput?: (request: MediaExecutionRequest) => Promise<void>;
		minimumFreeBytes?: number;
		maximumQueuedTasks?: number;
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
		repository: new MemoryInspectionStore(),
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
	const probe = vi.fn().mockResolvedValue(info);
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
		preparation = createPreparationApplication({
			probe,
			sources: library.sources,
			planning: compatibility,
			processing,
			repository: database.preparation,
			profiles,
			dataDir,
			logger,
			policy: {
				...preparationPolicy,
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
		_overrides: Record<string, string> = {},
	): Promise<PreparationRequest & { fileId: string }> {
		const source = await library.sources.resolveSource(file.id);
		return {
			fileId: file.id,
			sourceVersion: source.identity.sourceVersion,
			profileId: required(profiles[0]).id,
		};
	}

	return {
		inspection,
		probe,
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
				create: async (input: PreparationRequest & { fileId: string }) =>
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
				retry: async (id: string, input: PreparationRequest) =>
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

export async function taskId(response: Promise<PreparationStartResponse>) {
	const result = await response;
	if (result.kind !== "task") throw new Error(`Unexpected ${result.kind}`);
	return result.task.id;
}

export async function completed(
	f: Awaited<ReturnType<typeof fixture>>,
	id: string,
) {
	await vi.waitFor(async () => {
		expect((await f.preparation.get(id)).status).not.toMatch(
			/queued|processing/,
		);
	});
	return f.preparation.get(id);
}

export function waitForAbort(request: MediaExecutionRequest): Promise<void> {
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

export function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

export function setupTestLifecycle() {
	afterEach(async () => {
		for (const close of cleanup.splice(0).reverse()) await close();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
}
