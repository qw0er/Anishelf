import { transcodeProfileFingerprint } from "../../../system/public.js";
import type { PreparationView } from "../domain/model.js";
import type { PreparationArtifacts } from "./artifacts.js";
import type { PreparationContext } from "./context.js";

export class PreparationQueries {
	constructor(
		private readonly services: {
			context: PreparationContext;
			artifacts: PreparationArtifacts;
		},
	) {}
	async get(id: string): Promise<PreparationView> {
		const { artifacts } = this.services;
		return artifacts.inspect(id);
	}
	async list(
		fileId?: string,
		summary = false,
		more = false,
	): Promise<{ tasks: PreparationView[] }> {
		const { context, artifacts } = this.services;
		let tasks = context.repository.list(
			more || fileId
				? context.policy.listLimit
				: Math.min(context.policy.initialListLimit, context.policy.listLimit),
			fileId,
		);
		if (summary) {
			const epoch = context.sources.accessRevision;
			const scope = await context.sources.getScope();
			tasks = tasks.filter((task) =>
				scope.ids.includes(task.spec.source.scopeId),
			);
			context.sources.assertAccessRevision(epoch);
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
			tasks: await Promise.all(tasks.map((task) => artifacts.inspect(task.id))),
		};
	}
	/** A cheap directory projection. Validate playable resources only through detail/selection. */
	async summaries(fileIds: string[]) {
		const { context } = this.services;
		const epoch = context.sources.accessRevision;
		const scope = await context.sources.getScope();
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
		for (const row of context.repository.summaries(scope.ids, fileIds)) {
			if (fingerprints.get(row.profileId) !== row.profileFingerprint) continue;
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
		context.sources.assertAccessRevision(epoch);
		return { files };
	}
}
