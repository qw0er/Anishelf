import { DomainError } from "../../../shared/errors.js";
import type { MediaExecutionProgress } from "../../../shared/media-execution.js";
import type { ProcessedMedia } from "../../media-processing/public.js";
import type {
	PreparationFailureReason,
	PreparationTask,
} from "../domain/model.js";
import type { PreparationArtifacts } from "./artifacts.js";
import type { PreparationContext } from "./context.js";
import { preparationFailure } from "./failures.js";

export class PreparationWorker {
	constructor(
		private readonly context: PreparationContext,
		private readonly artifacts: PreparationArtifacts,
	) {}
	async run(task: PreparationTask, signal: AbortSignal): Promise<void> {
		let processed: ProcessedMedia | undefined;
		let progress: MediaExecutionProgress | null = null;
		let lastProgressSave = 0;
		let budgetFailure: PreparationFailureReason = "cache-full";
		let failure: PreparationFailureReason | undefined;
		try {
			signal.throwIfAborted();
			await this.context.source(task);
			const disk =
				(await this.context.files.availableBytes()) -
				this.context.policy.minimumFreeBytes;
			const remaining =
				this.context.maximumCacheBytes() - this.artifacts.retainedBytes();
			if (remaining <= 0)
				throw new DomainError(
					"PREPARATION_CACHE_FULL",
					"Delete a prepared copy before preparing another.",
				);
			if (disk <= 0)
				throw new DomainError(
					"PREPARATION_STORAGE_FULL",
					"Insufficient free disk storage.",
				);
			const maximumBytes = Math.min(remaining, disk);
			budgetFailure = disk < remaining ? "storage-full" : "cache-full";
			signal.throwIfAborted();
			this.context.assertOpen();
			const settings = task.spec.settings;
			const execution = this.context.processing.start({
				fileId: task.spec.source.fileId,
				sourceVersion: task.spec.source.sourceVersion,
				plan: { ...settings.plan, id: task.spec.executionPlanId },
				videoStreamIndex: settings.videoStreamIndex,
				audioStreamIndices: [...settings.audioStreamIndices],
				signal,
				maximumBytes,
				onEvent: (event) => {
					if (event.type !== "progress" || signal.aborted) return;
					progress = event.progress;
					if (
						Date.now() - lastProgressSave <
							this.context.policy.progressSaveMs &&
						!progress.ended
					)
						return;
					lastProgressSave = Date.now();
					const current = this.context.required(task.id);
					if (current.state.status !== "processing") return;
					current.state = {
						status: "processing",
						progress: { ...progress },
						failureReason: null,
						updatedAtMs: Date.now(),
					};
					this.context.repository.save(current);
				},
			});
			processed = await execution.completion;
			await this.artifacts.publish(
				task,
				processed,
				maximumBytes,
				progress,
				signal,
			);
		} catch (error) {
			failure = this.context.closed
				? "interrupted"
				: !this.context.profileValid(task)
					? "profile-changed"
					: preparationFailure(error, budgetFailure);
		}
		// Never acknowledge cancellation before the processor's temporary ownership is released.
		if (processed) await this.context.processing.release(processed.id);
		if (failure) await this.artifacts.finishFailure(task.id, failure, progress);
	}
}
