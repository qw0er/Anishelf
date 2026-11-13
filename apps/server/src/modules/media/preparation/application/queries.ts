import type {
	PreparedMediaItem,
	PreparedMediaList,
	PreparedMediaQuery,
} from "@anishelf/contracts/http";
import PQueue from "p-queue";
import type { PreparationArtifacts } from "../../artifacts/public.js";
import type { PreparationView } from "../domain/model.js";
import type { PreparedMediaInventory } from "../public.js";
import type { PreparationContext } from "./context.js";

export class PreparationQueries {
	async catalog(fileId: string): Promise<PreparedMediaInventory> {
		const { tasks } = await this.list(fileId);
		const result: PreparedMediaInventory = {
			assets: [],
		};
		for (const { task, artifact, availability } of tasks) {
			const source = { ...task.spec.source };
			const sourceAudioStreamIndices = [
				...task.spec.settings.audioStreamIndices,
			];
			if (artifact?.info && availability === "ready")
				result.assets.push({
					id: artifact.id,
					source,
					sourceAudioStreamIndices,
					profileId: task.profileId,
					sizeBytes: artifact.sizeBytes,
					mimeType: artifact.mimeType,
					info: artifact.info,
					updatedAtMs: task.state.updatedAtMs,
				});
		}
		result.assets.sort(
			(a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id),
		);
		return result;
	}

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
		inactiveLimit = 0,
	): Promise<{ tasks: PreparationView[]; hasMore: boolean }> {
		const { context, artifacts } = this.services;
		if (!fileId && summary) {
			const epoch = context.sources.accessRevision;
			const scope = await context.sources.getScope();
			const { tasks, hasMore } = context.repository.listMonitor(
				scope.ids,
				Math.max(0, Math.floor(inactiveLimit)),
			);
			context.sources.assertAccessRevision(epoch);
			return {
				tasks: tasks.map((task) => ({
					task,
					artifact:
						context.repository.artifact(task.spec.executionPlanId) ?? null,
					availability: "unknown" as const,
				})),
				hasMore,
			};
		}
		const tasks = context.repository.list(undefined, fileId);
		return {
			tasks: await Promise.all(tasks.map((task) => artifacts.inspect(task.id))),
			hasMore: false,
		};
	}
	async inventory(input: PreparedMediaQuery): Promise<PreparedMediaList> {
		const { context, artifacts } = this.services;
		const epoch = context.sources.accessRevision;
		const scope = await context.sources.getScope();
		const copies = context.repository.artifacts().filter((artifact) => {
			const task = context.repository.get(artifact.taskId);
			return task && scope.ids.includes(task.spec.source.scopeId);
		});
		const queue = new PQueue({ concurrency: 8 });
		const inspected = await Promise.all(
			copies.map((artifact) =>
				queue.add(async (): Promise<PreparedMediaItem | null> => {
					const state = await artifacts.managementState(artifact);
					if (!state) return null;
					const task = context.required(artifact.taskId);
					return {
						id: artifact.id,
						fileId: task.spec.source.fileId,
						sourceVersion: task.spec.source.sourceVersion,
						filename: task.filename,
						sourcePath: task.spec.source.relativePath,
						profileName:
							context.profiles.find((profile) => profile.id === task.profileId)
								?.name ?? task.profileId,
						audioStreamIndices: [...task.spec.settings.audioStreamIndices],
						sizeBytes: artifact.sizeBytes,
						createdAtMs: task.state.updatedAtMs,
						...state,
					};
				}),
			),
		);
		const availableBytes = await context.files.availableBytes();
		context.sources.assertAccessRevision(epoch);
		const items = inspected.filter(
			(item): item is PreparedMediaItem => item != null,
		);
		const usage = {
			count: items.length,
			copyBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
			retainedBytes: artifacts.retainedBytes(),
			availableBytes,
		};
		const search = input.search?.trim().toLowerCase() ?? "";
		const filtered = items.filter(
			(item) =>
				(!input.status || item.status === input.status) &&
				(!search ||
					`${item.filename} ${item.sourcePath}`.toLowerCase().includes(search)),
		);
		filtered.sort(
			(a, b) =>
				(input.sort === "size"
					? b.sizeBytes - a.sizeBytes
					: b.createdAtMs - a.createdAtMs) || a.id.localeCompare(b.id),
		);
		const page = Math.min(
			Number(input.page ?? 1),
			Math.max(1, Math.ceil(filtered.length / 50)),
		);
		return {
			items: filtered.slice((page - 1) * 50, page * 50),
			total: filtered.length,
			page,
			pageSize: 50,
			usage,
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
		for (const row of context.repository.summaries(scope.ids, fileIds)) {
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
