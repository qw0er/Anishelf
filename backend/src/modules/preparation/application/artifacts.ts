import { DomainError } from "../../../shared/errors.js";
import type { MediaExecutionProgress } from "../../../shared/media-execution.js";
import type { ProcessedMedia } from "../../media-processing/public.js";
import type { ResolvedSource } from "../../resource-access/public.js";
import type {
	PreparationFailureReason,
	PreparationTask,
	PreparationView,
} from "../domain/model.js";
import { InvalidPreparedMediaError } from "../infrastructure/files.js";
import {
	type PreparationContext,
	PreparationProfileChangedError,
} from "./context.js";
import { preparationFailure } from "./failures.js";

/** Only operations on the same artifact serialize. Planning and task control never acquire this gate. */
export class PreparationArtifacts {
	private readonly gates = new Map<string, Promise<unknown>>();
	private readonly borrowers = new Map<
		string,
		{ count: number; bytes: number }
	>();
	constructor(private readonly context: PreparationContext) {}
	private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const result = (this.gates.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(operation);
		const tail = result.catch(() => {});
		this.gates.set(id, tail);
		void tail.finally(() => {
			if (this.gates.get(id) === tail) this.gates.delete(id);
		});
		return result;
	}
	private view(task: PreparationTask): PreparationView {
		const artifact =
			task.state.status === "ready"
				? (this.context.repository.artifact(task.spec.executionPlanId) ?? null)
				: null;
		return {
			task,
			artifact,
			availability: artifact
				? this.context.sources.hasSnapshot
					? "ready"
					: "unknown"
				: "unavailable",
		};
	}
	assertUnborrowed(id: string): void {
		if (this.borrowers.has(id))
			throw new DomainError(
				"PREPARATION_BUSY",
				"This prepared media is still in use.",
			);
	}
	retainedBytes(): number {
		let bytes = this.context.repository.artifactBytes();
		for (const [id, borrowed] of this.borrowers)
			if (!this.context.repository.artifact(id)) bytes += borrowed.bytes;
		return bytes;
	}
	private async discard(
		task: PreparationTask,
		reason: PreparationFailureReason,
		progress: MediaExecutionProgress | null = task.state.progress,
	): Promise<void> {
		// Prevent new readers before deleting, retaining bytes until the last current reader releases.
		task.state = {
			status: "failed",
			failureReason: reason,
			progress,
			updatedAtMs: Date.now(),
		};
		this.context.repository.removeArtifact(task);
		if (!this.borrowers.has(task.spec.executionPlanId))
			await this.context.files.remove(task.spec.executionPlanId);
	}
	invalidate(
		task: PreparationTask,
		reason: PreparationFailureReason,
	): Promise<void> {
		return this.exclusive(task.spec.executionPlanId, () =>
			this.discard(this.context.required(task.id), reason),
		);
	}
	private async validate(task: PreparationTask): Promise<PreparationTask> {
		if (task.state.status !== "ready") return task;
		if (!this.context.profileValid(task)) {
			await this.discard(task, "profile-changed");
			return task;
		}
		let source: ResolvedSource | undefined;
		if (this.context.sources.hasSnapshot) {
			try {
				source = await this.context.source(task);
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				await this.discard(task, preparationFailure(error));
				return task;
			}
		}
		const artifact = this.context.repository.artifact(
			task.spec.executionPlanId,
		);
		if (!artifact) {
			await this.discard(task, "cache-missing");
			return task;
		}
		try {
			const handle = await this.context.files.open(artifact);
			await handle.close();
		} catch (error) {
			if (
				!(error instanceof InvalidPreparedMediaError) &&
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			await this.discard(task, "cache-missing");
		}
		if (task.state.status === "ready" && source) {
			try {
				await this.context.sources.revalidateSource(source);
				this.context.sources.assertRootEpoch(source.rootEpoch);
				if (!this.context.profileValid(task))
					throw new PreparationProfileChangedError();
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				await this.discard(task, preparationFailure(error));
			}
		}

		return task;
	}
	async inspect(id: string): Promise<PreparationView> {
		const task = this.context.required(id);
		if (task.state.status !== "ready") return this.view(task);
		return this.exclusive(task.spec.executionPlanId, async () =>
			this.view(await this.validate(this.context.required(id))),
		);
	}
	async open(id: string) {
		return this.exclusive(id, async () => {
			this.context.assertOpen();
			if (!this.context.sources.hasSnapshot)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Wait for the library scan before opening prepared media.",
				);
			const artifact = this.context.repository.artifact(id);
			if (!artifact)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			const task = await this.validate(this.context.required(artifact.taskId));
			if (task.state.status !== "ready")
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"Prepared media is no longer valid.",
				);
			const source = await this.context.source(task);
			const handle = await this.context.files.open(artifact);
			try {
				await this.context.sources.revalidateSource(source);
				this.context.sources.assertRootEpoch(source.rootEpoch);
				this.context.assertOpen();
			} catch (error) {
				await handle.close();
				throw error;
			}
			const previous = this.borrowers.get(id);
			this.borrowers.set(id, {
				count: (previous?.count ?? 0) + 1,
				bytes: artifact.sizeBytes,
			});
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
						await this.exclusive(id, async () => {
							const current = this.borrowers.get(id);
							if (!current) return;
							if (--current.count === 0) {
								this.borrowers.delete(id);
								if (
									!this.context.closed &&
									!this.context.repository.artifact(id)
								)
									await this.context.files.remove(id);
							}
						});
					}
				},
			};
		});
	}
	delete(id: string): Promise<void> {
		return this.exclusive(id, async () => {
			this.context.assertOpen();
			const artifact = this.context.repository.artifact(id);
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
			const task = this.context.required(artifact.taskId);
			task.state = {
				status: "cancelled",
				failureReason: "cache-deleted",
				progress: task.state.progress,
				updatedAtMs: Date.now(),
			};
			this.context.repository.removeArtifact(task);
			await this.context.files.remove(id);
		});
	}
	publish(
		task: PreparationTask,
		processed: ProcessedMedia,
		maximumBytes: number,
		progress: MediaExecutionProgress | null,
		signal: AbortSignal,
	): Promise<void> {
		return this.exclusive(task.spec.executionPlanId, async () => {
			signal.throwIfAborted();
			this.context.assertOpen();
			if (this.context.required(task.id).state.status !== "processing")
				throw new Error("Preparation stopped before publication.");
			if (processed.sizeBytes >= maximumBytes)
				throw new DomainError(
					"PREPARATION_CACHE_FULL",
					"Prepared media exceeds its output budget.",
				);
			const source = await this.context.source(task);
			await this.context.files.publish(
				task.spec.executionPlanId,
				processed.output.path,
				processed.sizeBytes,
			);
			await this.context.sources.revalidateSource(source);
			this.context.sources.assertRootEpoch(source.rootEpoch);
			signal.throwIfAborted();
			this.context.assertOpen();
			if (!this.context.profileValid(task))
				throw new PreparationProfileChangedError();
			const mimeType = {
				mp4: "video/mp4",
				mov: "video/quicktime",
				webm: "video/webm",
				matroska: "video/x-matroska",
			}[task.spec.settings.plan.container];
			if (!mimeType) throw new Error("Unsupported prepared container.");
			task.state = {
				status: "ready",
				failureReason: null,
				progress,
				updatedAtMs: Date.now(),
			};
			this.context.repository.publish(task, {
				id: task.spec.executionPlanId,
				taskId: task.id,
				delivery: "file",
				sizeBytes: processed.sizeBytes,
				mimeType,
			});
			this.context.logger.info(
				{
					event: "preparation.ready",
					taskId: task.id,
					sizeBytes: processed.sizeBytes,
				},
				"Prepared media published.",
			);
		});
	}
	/** Called only after processor cleanup; retry cannot race this attempt's finalization. */
	finishFailure(
		id: string,
		reason: PreparationFailureReason,
		progress: MediaExecutionProgress | null,
	): Promise<void> {
		const task = this.context.required(id);
		return this.exclusive(task.spec.executionPlanId, async () => {
			await this.context.files.remove(task.spec.executionPlanId);
			const current = this.context.required(id);
			current.state =
				current.state.status === "cancelling"
					? {
							status: "cancelled",
							failureReason: "cancelled",
							progress,
							updatedAtMs: Date.now(),
						}
					: {
							status: "failed",
							failureReason: reason,
							progress,
							updatedAtMs: Date.now(),
						};
			this.context.repository.removeArtifact(current);
			this.context.logger.warn(
				{
					event: "preparation.failed",
					taskId: id,
					reason: current.state.failureReason,
				},
				"Media preparation did not complete.",
			);
		});
	}
}
