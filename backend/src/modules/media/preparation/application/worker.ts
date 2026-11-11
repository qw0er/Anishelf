import type { MediaExecutionProgress } from "../../../../platform/media/events.js";
import { DomainError } from "../../../../shared/errors.js";
import type { PreparationArtifacts } from "../../artifacts/public.js";
import type {
	PreparationFailureReason,
	PreparationTask,
} from "../domain/model.js";
import type { ProcessedMedia } from "../execution/public.js";
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
		let failure: PreparationFailureReason | undefined;
		try {
			signal.throwIfAborted();
			await this.context.source(task);
			const maximumBytes =
				(await this.context.files.availableBytes()) -
				this.context.policy.minimumFreeBytes;
			if (maximumBytes <= 0)
				throw new DomainError(
					"PREPARATION_STORAGE_FULL",
					"Insufficient free disk storage.",
				);
			signal.throwIfAborted();
			this.context.assertOpen();
			this.context.logger.debug(
				{
					event: "preparation.output_space_checked",
					taskId: task.id,
					maximumBytes,
				},
				"Checked available disk space for preparation output.",
			);
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
				this.context.policy.minimumFreeBytes,
				progress,
				signal,
			);
		} catch (error) {
			failure = this.context.closed ? "interrupted" : preparationFailure(error);
		}
		// Never acknowledge cancellation before the processor's temporary ownership is released.
		if (processed) await this.context.processing.release(processed.id);
		if (failure) await this.artifacts.finishFailure(task.id, failure, progress);
	}
}
