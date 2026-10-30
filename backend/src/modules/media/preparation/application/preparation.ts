import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type {
	CompatibilityCheckRequest,
	MediaPlanningResult,
} from "../../media-planning/public.js";
import type {
	PreparationCreation,
	PreparationTask,
	PreparationView,
} from "../domain/model.js";
import type { PreparationPolicy } from "../policy.js";
import type { PreparationPlanner } from "../ports.js";
import type { PreparationApi } from "../public.js";
import type { PreparationArtifacts } from "./artifacts.js";
import type { PreparationContext } from "./context.js";
import type { PreparationQueries } from "./queries.js";
import type { PreparationScheduler } from "./scheduler.js";

export interface PreparationServices {
	context: PreparationContext;
	artifacts: PreparationArtifacts;
	scheduler: PreparationScheduler;
	queries: PreparationQueries;
	recover(): Promise<void>;
}

/** Command facade. Slow negotiation, source inspection and queries do not share a global queue. */
export class PreparationApplication implements PreparationApi {
	private readonly policy: DeepReadonly<PreparationPolicy>;
	private initialization: Promise<void> | undefined;
	private system: PreparationServices | undefined;
	private closed = false;
	private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
	private cleanupRun: Promise<void> | undefined;
	private readonly operations = new Set<Promise<unknown>>();
	constructor(
		private readonly options: {
			planning: PreparationPlanner;
			policy: DeepReadonly<PreparationPolicy>;
			services: PreparationServices;
		},
	) {
		this.policy = options.policy;
	}

	initialize(): Promise<void> {
		if (this.closed)
			return Promise.reject(
				new DomainError("PREPARATION_UNAVAILABLE", "Preparation is closed."),
			);
		this.initialization ??= Promise.resolve().then(async () => {
			const system = this.options.services;
			system.context.closed = this.closed;
			this.system = system;
			await system.recover();
			this.scheduleCleanup();
		});
		return this.initialization;
	}
	private scheduleCleanup(): void {
		if (this.closed) return;
		this.cleanupTimer = setTimeout(() => {
			this.cleanupTimer = undefined;
			const system = this.options.services;
			this.cleanupRun = system.artifacts
				.cleanupMissingSources()
				.catch((error) => {
					system.context.logger.warn(
						{
							event: "preparation.cleanup_failed",
							errorName: error instanceof Error ? error.name : "unknown",
						},
						"Prepared copy cleanup failed; another sweep will be scheduled.",
					);
				})
				.finally(() => {
					this.cleanupRun = undefined;
					this.scheduleCleanup();
				});
		}, this.policy.cleanupIntervalMs);
		this.cleanupTimer.unref();
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
			const planned = await this.options.planning.plan(input, {
				forcePreparation: true,
			});
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
		if (source.identity.scopeId !== planned.identity.rootId)
			throw new DomainError("PLAYBACK_CONFLICT", "The source root changed.");
		await context.sources.revalidateSource(source);
		context.sources.assertAccessRevision(source.accessRevision);
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
	catalog(fileId: string) {
		return this.track(async () =>
			(await this.ensure()).queries.catalog(fileId),
		);
	}
	get(id: string): Promise<PreparationView> {
		return this.track(async () => (await this.ensure()).queries.get(id));
	}
	list(
		fileId?: string,
		summary = false,
		more = false,
	): Promise<{ tasks: PreparationView[] }> {
		return this.track(async () =>
			(await this.ensure()).queries.list(fileId, summary, more),
		);
	}
	summaries(fileIds: string[]) {
		return this.track(async () =>
			(await this.ensure()).queries.summaries(fileIds),
		);
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
			const planned = await this.options.planning.plan(
				{
					...input,
					fileId: task.spec.source.fileId,
				},
				{ forcePreparation: true },
			);
			scheduler.assertHealthy();
			if (
				planned.kind !== "processing-required" ||
				planned.identity.sourceVersion !== task.spec.source.sourceVersion ||
				planned.identity.rootId !== task.spec.source.scopeId ||
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
		clearTimeout(this.cleanupTimer);
		if (this.system) this.system.context.closed = true;
		await this.initialization?.catch(() => {});
		const results = await Promise.allSettled([
			this.system?.scheduler.close(),
			this.cleanupRun,
			...this.operations,
		]);
		const stopped = results[0];
		if (stopped?.status === "rejected") throw stopped.reason;
	}
}
