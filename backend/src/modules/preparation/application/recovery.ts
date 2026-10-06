import type { PreparationArtifacts } from "./artifacts.js";
import type { PreparationContext } from "./context.js";
/** Startup reconciliation never restarts incomplete commands implicitly. */
export class PreparationRecovery {
	constructor(
		private readonly context: PreparationContext,
		private readonly artifacts: PreparationArtifacts,
	) {}
	async run(): Promise<void> {
		await this.context.processing.initialize();
		const valid = await this.context.files.initialize(
			this.context.repository.artifacts(),
		);
		for (const task of this.context.repository.list()) {
			if (["queued", "processing", "cancelling"].includes(task.state.status))
				await this.artifacts.invalidate(task, "interrupted");
			else if (!this.context.profileValid(task))
				await this.artifacts.invalidate(task, "profile-changed");
			else if (
				task.state.status === "ready" &&
				!valid.has(task.spec.executionPlanId)
			)
				await this.artifacts.invalidate(task, "cache-missing");
			else if (task.state.status !== "ready") {
				this.context.repository.removeArtifact(task);
				await this.context.files.remove(task.spec.executionPlanId);
			}
		}
		this.context.logger.info(
			{ event: "preparation.initialized" },
			"Prepared media cache reconciled.",
		);
	}
}
