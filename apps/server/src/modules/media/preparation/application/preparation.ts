import { randomUUID } from "node:crypto";
import type {
	PreparedMediaDeleteResponse,
	PreparedMediaQuery,
} from "@anishelf/contracts/http";
import type { MediaProcessingPlan } from "../../../../platform/media/specification.js";
import { DomainError } from "../../../../shared/errors.js";
import { fingerprint } from "../../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { PreparationArtifacts } from "../../artifacts/public.js";
import type {
	PreparationCreation,
	PreparationTask,
	PreparationView,
} from "../domain/model.js";
import type {
	MediaPlanningResult,
	PreparationRequest,
} from "../planning/public.js";
import type { PreparationPolicy } from "../policy.js";
import type { PreparationPlanner } from "../ports.js";
import type { PreparationApi } from "../public.js";

import type { PreparationContext } from "./context.js";
import type { PreparationQueries } from "./queries.js";
import type { PreparationScheduler } from "./scheduler.js";

function executionFingerprint(
	plan: DeepReadonly<Omit<MediaProcessingPlan, "id">>,
	video: number,
	audios: readonly number[],
): string {
	return fingerprint({
		compilerVersion: plan.compilerVersion,
		preserveSubtitles: plan.preserveSubtitles,
		globalOptions: Object.entries(plan.globalOptions ?? {}),
		inputOptions: Object.entries(plan.inputOptions ?? {}),
		muxerOptions: Object.entries(plan.muxerOptions ?? {}),
		container: plan.container,
		delivery: plan.delivery ?? "file",
		video,
		videoExecution: plan.video,
		videoParameters: plan.videoParameters,
		videoFilters: plan.videoFilters,
		h264Level: plan.h264Level,
		audios: audios.map((sourceIndex) => {
			const track = plan.audioTracks?.find(
				(t) => t.sourceIndex === sourceIndex,
			);
			return {
				sourceIndex,
				execution: track?.execution ?? plan.audio,
				parameters: track ? track.parameters : plan.audioParameters,
			};
		}),
	});
}

import { PreparationCleanup } from "./cleanup.js";

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
	private readonly cleanup: PreparationCleanup;
	private readonly operations = new Set<Promise<unknown>>();
	constructor(
		private readonly options: {
			planning: PreparationPlanner;
			policy: DeepReadonly<PreparationPolicy>;
			services: PreparationServices;
		},
	) {
		this.policy = options.policy;
		this.cleanup = new PreparationCleanup(
			options.policy.cleanupIntervalMs,
			() => options.services.artifacts.cleanupMissingSources(),
			options.services.context.logger,
		);
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
			this.cleanup.start();
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
		input: PreparationRequest & { fileId: string },
	): Promise<PreparationCreation> {
		input = structuredClone(input);
		return this.track(async () => {
			const { scheduler } = await this.ensure();
			const planned = await this.options.planning.plan(input);
			scheduler.assertHealthy();
			if (planned.kind === "blocked")
				return { kind: "blocked", reason: planned.reason };
			return {
				kind: "task",
				view: await this.enqueue(input, input.profileId, planned),
			};
		});
	}
	private async enqueue(
		input: {
			fileId: string;
			sourceVersion: string;
		} & Partial<PreparationRequest>,
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
		const existing =
			context.repository.find(planned.identity.executionPlanId) ??
			(
				context.repository.findReusable?.(
					input.fileId,
					input.sourceVersion,
					planned.identity.profileFingerprint,
				) ?? []
			).find(
				(task) =>
					["queued", "processing", "ready"].includes(task.state.status) &&
					task.spec.source.sourceVersion === input.sourceVersion &&
					task.spec.profileFingerprint ===
						planned.identity.profileFingerprint &&
					executionFingerprint(
						task.spec.settings.plan,
						task.spec.settings.videoStreamIndex,
						task.spec.settings.audioStreamIndices,
					) ===
						executionFingerprint(
							planned.execution.plan,
							planned.execution.videoStreamIndex,
							planned.execution.audioStreamIndices,
						),
			);
		if (existing) {
			existing.demand = { origin: "manual" };
			context.repository.save(existing);
			if (
				retryExisting &&
				(existing.state.status === "failed" ||
					existing.state.status === "cancelled")
			)
				return this.retry(existing.id, input as PreparationRequest);
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
			demand: { origin: "manual" },
			filename: source.file.name,
			profileId: profileId,
			createdAtMs: now,
			spec: freeze({
				source: source.identity,
				executionPlanId: planned.identity.executionPlanId,
				profileFingerprint: planned.identity.profileFingerprint,
				settings: {
					version: 2,
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
				reasons: task.spec.settings.reasons,
				profileId: task.profileId,
				profileFingerprint: task.spec.profileFingerprint,
				executionPlanId: task.spec.executionPlanId,
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
		inactiveLimit = 0,
	): Promise<{ tasks: PreparationView[]; hasMore: boolean }> {
		return this.track(async () =>
			(await this.ensure()).queries.list(fileId, summary, inactiveLimit),
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
	async retryRequest(id: string, input: object): Promise<PreparationView> {
		const task = (await this.ensure()).context.required(id);
		return this.retry(id, {
			sourceVersion: task.spec.source.sourceVersion,
			profileId: task.profileId,
			audioStreamIndices: [...task.spec.settings.audioStreamIndices],
			...input,
		});
	}

	retry(id: string, input: PreparationRequest): Promise<PreparationView> {
		input = structuredClone(input);
		return this.track(async () => {
			const { context, scheduler, artifacts } = await this.ensure();
			const task = context.required(id);
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
				planned.identity.rootId !== task.spec.source.scopeId
			)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The source changed. Create a new preparation.",
				);
			if (
				planned.identity.profileFingerprint !== task.spec.profileFingerprint
			) {
				context.logger.info(
					{
						event: "preparation.retry_profile_changed",
						taskId: task.id,
						profileId: input.profileId,
					},
					"Preparation profile changed; creating a replacement task.",
				);
				return this.enqueue(
					{ ...input, fileId: task.spec.source.fileId },
					input.profileId,
					planned,
					true,
				);
			}
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
					input.profileId,
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
			current.profileId = input.profileId;
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
	inventory(input: PreparedMediaQuery) {
		return this.track(async () =>
			(await this.ensure()).queries.inventory(input),
		);
	}
	deleteArtifacts(ids: string[]): Promise<PreparedMediaDeleteResponse> {
		return this.track(async () => {
			const { artifacts, context } = await this.ensure();
			const results: PreparedMediaDeleteResponse["results"] = [];
			for (const id of ids) {
				try {
					await artifacts.delete(id);
					results.push({ id, error: null });
				} catch (error) {
					results.push({
						id,
						error: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
					});
				}
			}
			context.logger.info(
				{
					event: "preparation.batch_deleted",
					requested: ids.length,
					deleted: results.filter((result) => result.error === null).length,
				},
				"Prepared copy batch deletion completed.",
			);
			return { results };
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
		const cleanup = this.cleanup.close();
		if (this.system) this.system.context.closed = true;
		await this.initialization?.catch(() => {});
		const results = await Promise.allSettled([
			this.system?.scheduler.close(),
			cleanup,
			...this.operations,
		]);
		const stopped = results[0];
		if (stopped?.status === "rejected") throw stopped.reason;
	}
}
