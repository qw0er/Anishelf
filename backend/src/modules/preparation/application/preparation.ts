import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type { CompatibilityCheckRequest } from "../../../shared/media-negotiation.js";
import type { MediaPlanningResult } from "../../../shared/media-planning.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import {
	type TranscodeProfile,
	transcodeProfileFingerprint,
} from "../../../shared/transcode-profiles.js";
import type { MediaProcessingApi } from "../../media-processing/public.js";
import {
	type ResourceAccessApi,
	resourceRootId,
} from "../../resource-access/public.js";
import type {
	PreparationCreation,
	PreparationTask,
	PreparationView,
} from "../domain/model.js";
import {
	type PreparationPolicy,
	preparationPolicy,
	validatePreparationPolicy,
} from "../domain/policy.js";
import { PreparedMediaFiles } from "../infrastructure/files.js";
import type { PreparationPlanner, PreparationStore } from "../ports.js";
import type { PreparationApi } from "../public.js";
import { PreparationArtifacts } from "./artifacts.js";
import { PreparationContext } from "./context.js";
import { PreparationRecovery } from "./recovery.js";
import { PreparationScheduler } from "./scheduler.js";
import { PreparationWorker } from "./worker.js";

/** Command facade. Slow negotiation, source inspection and queries do not share a global queue. */
export class PreparationApplication implements PreparationApi {
	private readonly policy: DeepReadonly<PreparationPolicy>;
	private initialization: Promise<void> | undefined;
	private system:
		| {
				context: PreparationContext;
				artifacts: PreparationArtifacts;
				scheduler: PreparationScheduler;
		  }
		| undefined;
	private closed = false;
	private readonly operations = new Set<Promise<unknown>>();
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			planning: PreparationPlanner;
			processing: MediaProcessingApi;
			repository?: PreparationStore;
			profiles: DeepReadonly<TranscodeProfile[]>;
			dataDir: string;
			logger: Logger;
			policy?: DeepReadonly<PreparationPolicy>;
			maximumCacheBytes?: () => number;
		},
	) {
		this.policy = freeze(structuredClone(options.policy ?? preparationPolicy));
		validatePreparationPolicy(this.policy);
	}
	initialize(): Promise<void> {
		if (this.closed)
			return Promise.reject(
				new DomainError("PREPARATION_UNAVAILABLE", "Preparation is closed."),
			);
		this.initialization ??= Promise.resolve().then(async () => {
			if (!this.options.repository)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Preparation persistence is unavailable.",
				);
			const context = new PreparationContext(
				this.options.repository,
				this.options.sources,
				this.options.processing,
				new PreparedMediaFiles(this.options.dataDir),
				this.options.profiles,
				this.policy,
				this.options.logger,
				this.options.maximumCacheBytes,
			);
			context.closed = this.closed;
			const artifacts = new PreparationArtifacts(context);
			const scheduler = new PreparationScheduler(
				context,
				new PreparationWorker(context, artifacts),
			);
			this.system = { context, artifacts, scheduler };
			await new PreparationRecovery(context, artifacts).run();
		});
		return this.initialization;
	}
	private async ensure() {
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
		if (!this.system || this.closed)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation is closed.",
			);
		return this.system;
	}
	private track<T>(operation: () => Promise<T>): Promise<T> {
		const result = operation();
		this.operations.add(result);
		void result.then(
			() => this.operations.delete(result),
			() => this.operations.delete(result),
		);
		return result;
	}
	create(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<PreparationCreation> {
		input = structuredClone(input);
		return this.track(async () => {
			const { scheduler } = await this.ensure();
			if (input.output?.target !== "file")
				throw new DomainError(
					"INVALID_REQUEST",
					"Preparation requires a completed-file output profile.",
				);
			const planned = await this.options.planning.plan(input);
			scheduler.assertHealthy();
			if (planned.kind === "playable")
				return {
					kind: "direct",
					fileId: planned.fileId,
					mimeType: planned.mimeType,
				};
			if (planned.kind === "blocked")
				return { kind: "blocked", reason: planned.reason };
			return {
				kind: "task",
				view: await this.enqueue(input, input.output.profileId, planned),
			};
		});
	}
	private async enqueue(
		input: CompatibilityCheckRequest & { fileId: string },
		profileId: string,
		planned: DeepReadonly<
			Extract<MediaPlanningResult, { kind: "processing-required" }>
		>,
		retryExisting = false,
	): Promise<PreparationView> {
		const { context, artifacts, scheduler } = await this.ensure();
		const source = await context.sources.resolveSource(
			input.fileId,
			input.sourceVersion,
		);
		if (
			resourceRootId(source.identity.canonicalRoot) !== planned.identity.rootId
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The source root changed.");
		await context.sources.revalidateSource(source);
		context.sources.assertRootEpoch(source.rootEpoch);
		scheduler.assertHealthy();
		// Deduplication, capacity check and insertion are synchronous: no await between them.
		const existing = context.repository.find(planned.identity.executionPlanId);
		if (existing) {
			if (
				retryExisting &&
				(existing.state.status === "failed" ||
					existing.state.status === "cancelled")
			)
				return this.retry(existing.id, input);
			return artifacts.inspect(existing.id);
		}
		if (context.repository.queuedCount() >= this.policy.maximumQueuedTasks)
			throw new DomainError(
				"PREPARATION_BUSY",
				"The preparation queue is full.",
			);
		const { id: _id, ...plan } = planned.execution.plan;
		const now = Date.now();
		const task: PreparationTask = {
			id: randomUUID(),
			filename: source.file.name,
			profileId: profileId,
			createdAtMs: now,
			spec: freeze({
				source: source.identity,
				executionPlanId: planned.identity.executionPlanId,
				profileFingerprint: planned.identity.profileFingerprint,
				settings: {
					version: 1,
					plan,
					mode: planned.mode,
					reasons: { ...planned.reasons },
					videoStreamIndex: planned.execution.videoStreamIndex,
					audioStreamIndices: [...planned.execution.audioStreamIndices],
				},
			}),
			state: {
				status: "queued",
				progress: null,
				failureReason: null,
				updatedAtMs: now,
			},
		};
		context.repository.insert(task);
		context.logger.info(
			{
				event: "preparation.queued",
				taskId: task.id,
				fileId: task.spec.source.fileId,
				mode: task.spec.settings.mode,
			},
			"Media preparation queued.",
		);
		scheduler.wake();
		return { task, artifact: null, availability: "unavailable" };
	}
	get(id: string): Promise<PreparationView> {
		return this.track(async () => {
			const { artifacts } = await this.ensure();
			return artifacts.inspect(id);
		});
	}
	list(
		fileId?: string,
		summary = false,
		more = false,
	): Promise<{ tasks: PreparationView[] }> {
		return this.track(async () => {
			const { context, artifacts } = await this.ensure();
			let tasks = context.repository.list(
				more || fileId
					? this.policy.listLimit
					: Math.min(this.policy.initialListLimit, this.policy.listLimit),
				fileId,
			);
			if (summary) {
				const epoch = context.sources.resourceRootEpoch;
				const root = await context.sources.resolveRoot();
				tasks = tasks.filter((task) => task.spec.source.canonicalRoot === root);
				context.sources.assertRootEpoch(epoch);
				return {
					tasks: tasks.map((task) => ({
						task,
						artifact:
							context.repository.artifact(task.spec.executionPlanId) ?? null,
						availability: "unknown" as const,
					})),
				};
			}
			return {
				tasks: await Promise.all(
					tasks.map((task) => artifacts.inspect(task.id)),
				),
			};
		});
	}
	/** A cheap directory projection. Validate playable resources only through detail/selection. */
	summaries(fileIds: string[]) {
		return this.track(async () => {
			const { context } = await this.ensure();
			const epoch = context.sources.resourceRootEpoch;
			const root = await context.sources.resolveRoot();
			const files = fileIds.map((fileId) => ({
				fileId,
				versions: [] as {
					sourceVersion: string;
					publishedCopies: number;
					pendingTasks: number;
				}[],
			}));
			const byFile = new Map(files.map((file) => [file.fileId, file]));
			const fingerprints = new Map(
				context.profiles.map((profile) => [
					profile.id,
					transcodeProfileFingerprint(profile),
				]),
			);
			for (const row of context.repository.summaries(root, fileIds)) {
				if (fingerprints.get(row.profileId) !== row.profileFingerprint)
					continue;
				const file = byFile.get(row.fileId);
				if (!file) continue;
				let version = file.versions.find(
					(value) => value.sourceVersion === row.sourceVersion,
				);
				if (!version) {
					version = {
						sourceVersion: row.sourceVersion,
						publishedCopies: 0,
						pendingTasks: 0,
					};
					file.versions.push(version);
				}
				if (row.status === "ready" && row.published) version.publishedCopies++;
				if (["queued", "processing", "cancelling"].includes(row.status))
					version.pendingTasks++;
			}
			context.sources.assertRootEpoch(epoch);
			return { files };
		});
	}

	cancel(id: string): Promise<PreparationView> {
		return this.track(async () => {
			const { scheduler, artifacts } = await this.ensure();
			await scheduler.cancel(id);
			return artifacts.inspect(id);
		});
	}
	retry(
		id: string,
		input: CompatibilityCheckRequest,
	): Promise<PreparationView> {
		input = structuredClone(input);
		return this.track(async () => {
			const { context, scheduler, artifacts } = await this.ensure();
			const task = context.required(id);
			if (input.output?.target !== "file")
				throw new DomainError(
					"INVALID_REQUEST",
					"Retry requires fresh file-output compatibility evidence.",
				);
			if (
				scheduler.isActive(id) ||
				["queued", "processing", "cancelling"].includes(task.state.status)
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"This preparation is already active.",
				);
			if (task.state.status === "ready")
				throw new DomainError(
					"INVALID_REQUEST",
					"This preparation is already ready.",
				);
			const planned = await this.options.planning.plan({
				...input,
				fileId: task.spec.source.fileId,
			});
			scheduler.assertHealthy();
			if (
				planned.kind !== "processing-required" ||
				planned.identity.sourceVersion !== task.spec.source.sourceVersion ||
				planned.identity.rootId !==
					resourceRootId(task.spec.source.canonicalRoot) ||
				planned.identity.profileFingerprint !== task.spec.profileFingerprint
			)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The source or processing profile changed. Create a new preparation.",
				);
			// Re-read after negotiation; another retry/cancel may have completed while it was awaited.
			const current = context.required(id);
			if (
				scheduler.isActive(id) ||
				["queued", "processing", "cancelling"].includes(current.state.status)
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"This preparation is already active.",
				);
			if (current.state.status === "ready")
				throw new DomainError(
					"INVALID_REQUEST",
					"This preparation is already ready.",
				);
			if (planned.identity.executionPlanId !== current.spec.executionPlanId) {
				// A new planner/browser decision owns a new immutable specification.
				return this.enqueue(
					{ ...input, fileId: current.spec.source.fileId },
					input.output.profileId,
					planned,
					true,
				);
			}
			artifacts.assertUnborrowed(current.spec.executionPlanId);
			if (context.repository.queuedCount() >= this.policy.maximumQueuedTasks)
				throw new DomainError(
					"PREPARATION_BUSY",
					"The preparation queue is full.",
				);
			current.profileId = input.output.profileId;
			current.state = {
				status: "queued",
				progress: null,
				failureReason: null,
				updatedAtMs: Date.now(),
			};
			context.repository.save(current);
			scheduler.wake();
			return { task: current, artifact: null, availability: "unavailable" };
		});
	}
	deleteArtifact(id: string): Promise<void> {
		return this.track(async () => {
			const { artifacts } = await this.ensure();
			await artifacts.delete(id);
		});
	}
	openArtifact(id: string) {
		return this.track(async () => {
			const { artifacts } = await this.ensure();
			return artifacts.open(id);
		});
	}
	async close(): Promise<void> {
		this.closed = true;
		if (this.system) this.system.context.closed = true;
		await this.initialization?.catch(() => {});
		const results = await Promise.allSettled([
			this.system?.scheduler.close(),
			...this.operations,
		]);
		const stopped = results[0];
		if (stopped?.status === "rejected") throw stopped.reason;
	}
}
