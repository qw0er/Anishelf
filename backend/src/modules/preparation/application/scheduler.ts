import { DomainError } from "../../../shared/errors.js";
import type { PreparationContext } from "./context.js";
import type { PreparationWorker } from "./worker.js";

export class PreparationScheduler {
	private active:
		| { id: string; controller: AbortController; done: Promise<void> }
		| undefined;
	private faulted = false;
	constructor(
		private readonly context: PreparationContext,
		private readonly worker: PreparationWorker,
	) {}
	assertHealthy(): void {
		this.context.assertOpen();
		if (this.faulted)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation cleanup failed. Restart to reconcile outputs.",
			);
	}
	isActive(id: string): boolean {
		return this.active?.id === id;
	}
	wake(): void {
		queueMicrotask(() => {
			try {
				if (this.context.closed || this.faulted || this.active) return;
				const task = this.context.repository.nextQueued();
				if (!task) return;
				task.state = {
					status: "processing",
					failureReason: null,
					progress: null,
					updatedAtMs: Date.now(),
				};
				this.context.repository.save(task);
				const controller = new AbortController();
				const done = Promise.resolve().then(() =>
					this.worker.run(task, controller.signal),
				);
				this.active = { id: task.id, controller, done };
				void done.then(
					() => {
						this.active = undefined;
						this.wake();
					},
					(error) => {
						this.faulted = true;
						this.active = undefined;
						this.context.logger.error(
							{
								event: "preparation.worker_failed",
								taskId: task.id,
								errorName: error instanceof Error ? error.name : "unknown",
							},
							"Preparation cleanup failed; recovery requires restart.",
						);
					},
				);
			} catch (error) {
				this.faulted = true;
				this.context.logger.error(
					{
						event: "preparation.queue_failed",
						errorName: error instanceof Error ? error.name : "unknown",
					},
					"Preparation queue could not be read.",
				);
			}
		});
	}
	async cancel(id: string): Promise<void> {
		this.assertHealthy();
		const task = this.context.required(id);
		if (
			task.state.status !== "queued" &&
			task.state.status !== "processing" &&
			task.state.status !== "cancelling"
		)
			return;
		const active = this.active?.id === id ? this.active : undefined;
		if (active) {
			task.state = {
				status: "cancelling",
				progress: task.state.progress,
				failureReason: null,
				updatedAtMs: Date.now(),
			};
			this.context.repository.save(task);
			active.controller.abort();
			await active.done;
		} else {
			task.state = {
				status: "cancelled",
				progress: task.state.progress,
				failureReason: "cancelled",
				updatedAtMs: Date.now(),
			};
			this.context.repository.save(task);
		}
	}
	async close(): Promise<void> {
		this.context.closed = true;
		this.active?.controller.abort();
		await this.active?.done;
	}
}
