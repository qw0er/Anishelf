import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type {
	CompatibilityCheckRequest,
	PreparationStartResponse,
} from "../../../contracts/http.js";
import {
	MediaOutputBudgetError,
	MediaToolError,
} from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { MediaExecutionProgress } from "../../../shared/media-execution.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import {
	type TranscodeProfile,
	transcodeProfileFingerprint,
} from "../../../shared/transcode-profiles.js";
import type {
	MediaProcessingApi,
	ProcessedMedia,
} from "../../media-processing/public.js";
import type { PlaybackApi } from "../../playback/public.js";
import {
	type ResourceAccessApi,
	resourceRootId,
} from "../../resource-access/public.js";
import type {
	PreparationFailureReason,
	PreparationTask,
	PreparationTaskDto,
} from "../domain/model.js";
import {
	type PreparationPolicy,
	preparationPolicy,
	validatePreparationPolicy,
} from "../domain/policy.js";
import {
	InvalidPreparedMediaError,
	PreparedMediaFiles,
} from "../infrastructure/files.js";
import type { PreparationRepository } from "../infrastructure/repository.js";

/** Owns persistent preparation and reusable completed files; never owns viewing progress. */
export class PreparationApplication {
	private readonly files: PreparedMediaFiles;
	private readonly policy: DeepReadonly<PreparationPolicy>;
	private initialization: Promise<void> | undefined;
	private changes: Promise<unknown> = Promise.resolve();
	private closed = false;
	private active:
		| { id: string; controller: AbortController; done: Promise<void> }
		| undefined;
	private readonly borrowers = new Map<string, number>();
	private readonly borrowedBytes = new Map<string, number>();
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			planning: Pick<PlaybackApi, "plan">;
			processing: MediaProcessingApi;
			repository?: PreparationRepository;
			profiles: DeepReadonly<TranscodeProfile[]>;
			dataDir: string;
			logger: Logger;
			policy?: DeepReadonly<PreparationPolicy>;
		},
	) {
		this.policy = freeze(structuredClone(options.policy ?? preparationPolicy));
		validatePreparationPolicy(this.policy);
		this.files = new PreparedMediaFiles(options.dataDir);
	}
	private repository(): PreparationRepository {
		if (!this.options.repository)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation persistence is unavailable.",
			);
		return this.options.repository;
	}
	private change<T>(operation: () => Promise<T> | T): Promise<T> {
		const result = this.changes.then(operation);
		this.changes = result.catch(() => {});
		return result;
	}
	initialize(): Promise<void> {
		this.initialization ??= this.reconcile();
		return this.initialization;
	}
	private async reconcile(): Promise<void> {
		const repository = this.repository();
		await this.options.processing.initialize();
		const valid = await this.files.initialize(repository.artifacts());
		for (const task of repository.list()) {
			if (task.status === "queued" || task.status === "processing")
				await this.invalidate(task, "interrupted");
			else if (!this.profileValid(task))
				await this.invalidate(task, "profile-changed");
			else if (
				task.status === "ready" &&
				!valid.has(task.identity.executionPlanId)
			)
				await this.invalidate(task, "cache-missing");
			else if (task.status !== "ready")
				await this.files.remove(task.identity.executionPlanId);
		}
		this.options.logger.info(
			{ event: "preparation.initialized" },
			"Prepared media cache reconciled.",
		);
	}
	private async ensure(): Promise<void> {
		if (this.closed)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation is closed.",
			);
		try {
			await this.initialize();
		} catch (cause) {
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation initialization failed.",
				{ cause },
			);
		}
		if (this.closed)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation is closed.",
			);
	}
	private profileValid(task: PreparationTask): boolean {
		const profile = this.options.profiles.find(
			(profile) => profile.id === task.profileId,
		);
		return (
			profile !== undefined &&
			transcodeProfileFingerprint(profile) === task.identity.profileFingerprint
		);
	}
	private async source(task: PreparationTask) {
		if (!this.profileValid(task))
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The preparation profile changed.",
			);
		const source = await this.options.sources.resolveSource(
			task.source.fileId,
			task.source.sourceVersion,
		);
		if (
			source.identity.canonicalRoot !== task.source.canonicalRoot ||
			source.identity.relativePath !== task.source.relativePath
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The preparation source changed.",
			);
		return source;
	}
	private required(id: string): PreparationTask {
		const task = this.repository().get(id);
		if (!task)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Preparation task not found.",
			);
		return task;
	}
	private dto(task: PreparationTask): PreparationTaskDto {
		const artifact =
			task.status === "ready"
				? this.repository().artifact(task.identity.executionPlanId)
				: undefined;
		return {
			id: task.id,
			fileId: task.source.fileId,
			filename: task.filename,
			sourceVersion: task.source.sourceVersion,
			profileId: task.profileId,
			mode: task.mode,
			reasons: { ...task.reasons },
			status: task.status,
			playbackAvailability: artifact
				? this.options.sources.hasSnapshot
					? "ready"
					: "unknown"
				: "unavailable",
			progress: task.progress ? { ...task.progress } : null,
			failureReason: task.failureReason,
			createdAtMs: task.createdAtMs,
			updatedAtMs: task.updatedAtMs,
			artifactId: artifact?.id ?? null,
			playbackUrl:
				artifact && this.options.sources.hasSnapshot
					? `/api/prepared-media/${artifact.id}`
					: null,
			sizeBytes: artifact?.sizeBytes ?? null,
		};
	}
	private async invalidate(
		task: PreparationTask,
		reason: PreparationFailureReason,
	): Promise<void> {
		task.status = "failed";
		task.failureReason = reason;
		task.updatedAtMs = Date.now();
		this.repository().removeArtifact(task);
		if (!this.borrowers.has(task.identity.executionPlanId))
			await this.files.remove(task.identity.executionPlanId);
	}
	private async validateReady(task: PreparationTask): Promise<void> {
		if (task.status !== "ready") return;
		if (!this.profileValid(task)) {
			await this.invalidate(task, "profile-changed");
			return;
		}
		if (this.options.sources.hasSnapshot) {
			try {
				await this.source(task);
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				await this.invalidate(task, "source-changed");
				return;
			}
		}
		const artifact = this.repository().artifact(task.identity.executionPlanId);
		if (!artifact) {
			await this.invalidate(task, "cache-missing");
			return;
		}
		try {
			const handle = await this.files.open(artifact);
			await handle.close();
		} catch (error) {
			if (
				!(error instanceof InvalidPreparedMediaError) &&
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			await this.invalidate(task, "cache-missing");
		}
	}
	async create(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<PreparationStartResponse> {
		input = structuredClone(input);
		await this.ensure();
		return this.change(async () => {
			if (this.closed)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Preparation is closed.",
				);
			if (input.output?.target !== "file")
				throw new DomainError(
					"INVALID_REQUEST",
					"Preparation requires a completed-file output profile.",
				);
			const planned = await this.options.planning.plan(input);
			if (this.closed)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Preparation is closed.",
				);
			if (planned.kind === "playable")
				return { kind: "direct", plan: { ...planned.plan } };
			if (planned.kind === "blocked")
				return { kind: "blocked", reason: planned.plan.reason };
			const repository = this.repository();
			const existing = repository.find(planned.identity.executionPlanId);
			if (existing) {
				await this.validateReady(existing);
				return { kind: "task", task: this.dto(existing) };
			}
			if (
				repository.list().filter((task) => task.status === "queued").length >=
				this.policy.maximumQueuedTasks
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"The preparation queue is full.",
				);
			const source = await this.options.sources.resolveSource(
				input.fileId,
				input.sourceVersion,
			);
			if (
				resourceRootId(source.identity.canonicalRoot) !==
				planned.identity.rootId
			)
				throw new DomainError("PLAYBACK_CONFLICT", "The source root changed.");
			await this.options.sources.revalidateSource(source);
			this.options.sources.assertRootEpoch(source.rootEpoch);
			const now = Date.now();
			const task: PreparationTask = {
				id: randomUUID(),
				source: source.identity,
				filename: source.file.name,
				identity: structuredClone(planned.identity),
				request: structuredClone(planned.execution),
				profileId: input.output.profileId,
				mode: planned.mode,
				reasons: { ...planned.reasons },
				status: "queued",
				progress: null,
				failureReason: null,
				createdAtMs: now,
				updatedAtMs: now,
			};
			repository.save(task);
			this.options.logger.info(
				{
					event: "preparation.queued",
					taskId: task.id,
					fileId: task.source.fileId,
					mode: task.mode,
				},
				"Media preparation queued.",
			);
			this.wake();
			return { kind: "task", task: this.dto(task) };
		});
	}
	async get(id: string): Promise<PreparationTaskDto> {
		await this.ensure();
		return this.change(async () => {
			const task = this.required(id);
			await this.validateReady(task);
			return this.dto(task);
		});
	}
	async list(fileId?: string): Promise<{ tasks: PreparationTaskDto[] }> {
		await this.ensure();
		return this.change(async () => {
			const tasks = this.repository().list(this.policy.listLimit, fileId);
			for (const task of tasks) await this.validateReady(task);
			return { tasks: tasks.map((task) => this.dto(task)) };
		});
	}
	async cancel(id: string): Promise<PreparationTaskDto> {
		await this.ensure();
		const done = await this.change(() => {
			const task = this.required(id);
			if (task.status !== "queued" && task.status !== "processing")
				return { pending: undefined };
			task.status = "cancelled";
			task.failureReason = "cancelled";
			task.updatedAtMs = Date.now();
			this.repository().save(task);
			const active = this.active?.id === id ? this.active : undefined;
			active?.controller.abort();
			return { pending: active?.done };
		});
		await done.pending;
		return this.get(id);
	}
	async retry(
		id: string,
		input: CompatibilityCheckRequest,
	): Promise<PreparationTaskDto> {
		input = structuredClone(input);
		await this.ensure();
		return this.change(async () => {
			const task = this.required(id);
			if (
				this.active?.id === id ||
				task.status === "queued" ||
				task.status === "processing"
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"This preparation is already active.",
				);
			if (task.status === "ready")
				throw new DomainError(
					"INVALID_REQUEST",
					"This preparation is already ready.",
				);
			if (input.output?.target !== "file")
				throw new DomainError(
					"INVALID_REQUEST",
					"Retry requires fresh file-output compatibility evidence.",
				);
			const planned = await this.options.planning.plan({
				...input,
				fileId: task.source.fileId,
			});
			if (
				planned.kind !== "processing-required" ||
				planned.identity.executionPlanId !== task.identity.executionPlanId
			)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The source or processing profile changed. Create a new preparation.",
				);
			if (
				this.repository()
					.list()
					.filter((task) => task.status === "queued").length >=
				this.policy.maximumQueuedTasks
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"The preparation queue is full.",
				);
			task.request = structuredClone(planned.execution);
			task.profileId = input.output.profileId;
			task.status = "queued";
			task.failureReason = null;
			task.progress = null;
			task.updatedAtMs = Date.now();
			this.repository().save(task);
			this.wake();
			return this.dto(task);
		});
	}
	async deleteArtifact(id: string): Promise<void> {
		await this.ensure();
		await this.change(async () => {
			const artifact = this.repository().artifact(id);
			if (!artifact)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			if (this.borrowers.has(id))
				throw new DomainError(
					"PREPARATION_BUSY",
					"This prepared media is in use.",
				);
			const task = this.required(artifact.taskId);
			task.status = "cancelled";
			task.failureReason = "cache-deleted";
			task.updatedAtMs = Date.now();
			this.repository().removeArtifact(task);
			await this.files.remove(id);
		});
	}
	async openArtifact(id: string) {
		await this.ensure();
		return this.change(async () => {
			if (!this.options.sources.hasSnapshot)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Wait for the library scan before opening prepared media.",
				);
			const artifact = this.repository().artifact(id);
			if (!artifact)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			const task = this.required(artifact.taskId);
			await this.validateReady(task);
			if (task.status !== "ready")
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"Prepared media is no longer valid.",
				);
			const source = await this.source(task);
			const handle = await this.files.open(artifact);
			try {
				await this.options.sources.revalidateSource(source);
				this.options.sources.assertRootEpoch(source.rootEpoch);
			} catch (error) {
				await handle.close();
				throw error;
			}
			this.borrowers.set(id, (this.borrowers.get(id) ?? 0) + 1);
			this.borrowedBytes.set(id, artifact.sizeBytes);
			let released = false;
			return {
				handle,
				sizeBytes: artifact.sizeBytes,
				mimeType: artifact.mimeType,
				release: async () => {
					if (released) return;
					released = true;
					try {
						await handle.close();
					} finally {
						await this.change(async () => {
							const count = (this.borrowers.get(id) ?? 1) - 1;
							if (count) this.borrowers.set(id, count);
							else {
								this.borrowers.delete(id);
								this.borrowedBytes.delete(id);
								if (!this.closed && !this.repository().artifact(id))
									await this.files.remove(id);
							}
						});
					}
				},
			};
		});
	}
	private wake(): void {
		queueMicrotask(() => {
			try {
				if (this.closed || this.active) return;
				const task = this.repository()
					.list()
					.filter((task) => task.status === "queued")
					.sort(
						(a, b) => a.updatedAtMs - b.updatedAtMs || a.id.localeCompare(b.id),
					)[0];
				if (!task) return;
				const controller = new AbortController();
				const done = Promise.resolve().then(() =>
					this.run(task, controller.signal),
				);
				this.active = { id: task.id, controller, done };
				void done
					.catch((error) =>
						this.options.logger.error(
							{
								event: "preparation.worker_failed",
								taskId: task.id,
								errorName: error instanceof Error ? error.name : "unknown",
							},
							"Preparation worker failed.",
						),
					)
					.finally(() => {
						this.active = undefined;
						this.wake();
					});
			} catch (error) {
				this.options.logger.error(
					{
						event: "preparation.queue_failed",
						errorName: error instanceof Error ? error.name : "unknown",
					},
					"Preparation queue could not be read.",
				);
			}
		});
	}
	private failure(error: unknown): PreparationFailureReason {
		if (error instanceof DomainError) {
			if (error.code === "PREPARATION_CACHE_FULL") return "cache-full";
			if (error.code === "PREPARATION_STORAGE_FULL") return "storage-full";
			if (
				[
					"PLAYBACK_CONFLICT",
					"RESOURCE_MISSING",
					"RESOURCE_NOT_FOUND",
					"RESOURCE_ROOT_UNAVAILABLE",
					"RESOURCE_ROOT_NOT_CONFIGURED",
					"RESOURCE_ACCESS_DENIED",
					"RESOURCE_UNREADABLE",
				].includes(error.code)
			)
				return "source-changed";
		}
		if (error instanceof MediaToolError) {
			if (error.code === "TOOL_UNAVAILABLE") return "tool-unavailable";
			if (error.code === "CAPABILITY_MISSING") return "capability-missing";
			if (error.code === "CAPABILITY_UNKNOWN") return "capability-unknown";
		}
		if (
			error instanceof Error &&
			(("code" in error && error.code === "ENOSPC") ||
				("diagnostic" in error &&
					typeof error.diagnostic === "string" &&
					/No space left on device/i.test(error.diagnostic)))
		)
			return "storage-full";
		return "processing-failed";
	}
	private async run(task: PreparationTask, signal: AbortSignal): Promise<void> {
		let processed: ProcessedMedia | undefined;
		let lastProgressSave = 0;
		let progress: MediaExecutionProgress | null = null;
		let budgetFailure: PreparationFailureReason = "cache-full";
		try {
			const maximumBytes = await this.change(async () => {
				signal.throwIfAborted();
				const current = this.required(task.id);
				if (current.status !== "queued")
					throw new Error("Preparation is no longer queued.");
				await this.source(task);
				const remaining =
					this.policy.maximumCacheBytes -
					this.repository()
						.artifacts()
						.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) -
					[...this.borrowedBytes].reduce(
						(sum, [id, bytes]) =>
							sum + (this.repository().artifact(id) ? 0 : bytes),
						0,
					);
				if (remaining <= 0)
					throw new DomainError(
						"PREPARATION_CACHE_FULL",
						"Delete a prepared copy before preparing another.",
					);
				const disk =
					(await this.files.availableBytes()) - this.policy.minimumFreeBytes;
				if (disk <= 0)
					throw new DomainError(
						"PREPARATION_STORAGE_FULL",
						"Insufficient free disk storage.",
					);
				task.status = "processing";
				budgetFailure = disk < remaining ? "storage-full" : "cache-full";
				task.updatedAtMs = Date.now();
				this.repository().save(task);
				return Math.min(remaining, disk);
			});
			signal.throwIfAborted();
			const execution = this.options.processing.start({
				...task.request,
				signal,
				maximumBytes,
				onEvent: (event) => {
					if (event.type !== "progress" || signal.aborted) return;
					progress = event.progress;
					if (
						Date.now() - lastProgressSave < this.policy.progressSaveMs &&
						!progress.ended
					)
						return;
					lastProgressSave = Date.now();
					const current = this.required(task.id);
					if (current.status !== "processing") return;
					current.progress = progress;
					current.updatedAtMs = Date.now();
					this.repository().save(current);
				},
			});
			processed = await execution.completion;
			await this.change(async () => {
				signal.throwIfAborted();
				const current = this.required(task.id);
				if (current.status !== "processing")
					throw new Error("Preparation was stopped before publication.");
				if (!processed || processed.sizeBytes >= maximumBytes)
					throw new DomainError(
						"PREPARATION_CACHE_FULL",
						"Prepared media exceeds its output budget.",
					);
				const source = await this.source(task);
				await this.files.publish(
					task.identity.executionPlanId,
					processed.path,
					processed.sizeBytes,
				);
				await this.options.sources.revalidateSource(source);
				this.options.sources.assertRootEpoch(source.rootEpoch);
				signal.throwIfAborted();
				task.status = "ready";
				task.failureReason = null;
				task.progress = progress;
				task.updatedAtMs = Date.now();
				const mimeType = (
					{
						mp4: "video/mp4",
						mov: "video/quicktime",
						webm: "video/webm",
						matroska: "video/x-matroska",
					} as Record<string, string>
				)[task.request.plan.container];
				if (!mimeType) throw new Error("Unsupported prepared container.");
				this.repository().publish(task, {
					id: task.identity.executionPlanId,
					taskId: task.id,
					sizeBytes: processed.sizeBytes,
					mimeType,
				});
				this.options.logger.info(
					{
						event: "preparation.ready",
						taskId: task.id,
						sizeBytes: processed.sizeBytes,
					},
					"Prepared media published.",
				);
			});
		} catch (error) {
			await this.change(async () => {
				const current = this.required(task.id);
				if (current.status !== "cancelled") {
					current.status = "failed";
					current.failureReason = this.closed
						? "interrupted"
						: !this.profileValid(current)
							? "profile-changed"
							: error instanceof MediaOutputBudgetError
								? budgetFailure
								: this.failure(error);
					current.updatedAtMs = Date.now();
					current.progress = progress;
					this.repository().removeArtifact(current);
				}
				await this.files.remove(task.identity.executionPlanId);
				this.options.logger.warn(
					{
						event: "preparation.failed",
						taskId: task.id,
						reason: current.failureReason,
					},
					"Media preparation did not complete.",
				);
			});
		} finally {
			if (processed) await this.options.processing.release(processed.id);
		}
	}
	async close(): Promise<void> {
		this.closed = true;
		this.active?.controller.abort();
		await this.initialization?.catch(() => {});
		await this.changes;
		await this.active?.done.catch(() => {});
		await this.changes;
	}
}
