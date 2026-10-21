import { posix } from "node:path";
import type { DownloadTask } from "../../qbittorrent/public.js";
import {
	type QbittorrentApi,
	QbittorrentError,
} from "../../qbittorrent/public.js";
import { DownloadError, type DownloadIntent } from "../domain/model.js";
import { absoluteDownloadPath } from "../domain/paths.js";
import { resolveTorrent } from "../infrastructure/torrent.js";
import type { DownloadContext, DownloadExecution } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import { downloadPolicy as policy } from "./policy.js";

export class DownloadSubmission {
	constructor(
		private readonly context: DownloadContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	async observe(
		execution: DownloadExecution,
		client: QbittorrentApi,
	): Promise<{ item: DownloadIntent; task: DownloadTask } | null> {
		let item = execution.current;
		let task = await client.task(item.hash, this.context.signal);
		this.context.open();
		const latest = this.context.options.store.intent(item.id);
		if (!latest || latest.revision !== item.revision) return null;

		if (!task && ["unknown", "submitting"].includes(item.state)) {
			execution.save({
				...item,
				state: "unknown",
				error: "submission_unconfirmed",
				nextAttemptAt: this.context.now() + policy.idleIntervalMs,
			});
			return null;
		}
		if (!task && item.state === "bound") {
			execution.save({
				...item,
				state: "missing",
				transfer: "missing",
				error: "externally_removed",
				observedAt: this.context.now(),
			});
			return null;
		}
		if (!task) {
			const subscription = this.context.options.selection.subscription(
				item.workKey,
			);
			if (!subscription || !this.destination.authorized(subscription))
				return null;
			if (subscription.startEpisode > item.episode) return null;
			const destination = this.context.options.store.destination();
			if (!destination || destination.revision !== item.destination.revision)
				throw new DownloadError("destination_changed");
			const target = await this.context.options.anime.target(
				item.workKey,
				this.context.signal,
			);
			if (target.availableEpisodes.includes(item.episode)) {
				execution.save({
					...item,
					state: "blocked",
					error: "already_available",
				});
				return null;
			}
			const assessment = this.context.options.anime.assess(item.title, target);
			if (!assessment.eligible || assessment.episode !== item.episode) {
				execution.save({
					...item,
					state: "blocked",
					error: "release_evidence_changed",
				});
				return null;
			}
			const snapshot = await client.tasks(this.context.signal);
			if (
				snapshot.some((task) => {
					if ([task.hash, task.v1Hash, task.v2Hash].includes(item.hash))
						return true;
					const assessment = this.context.options.anime.assess(
						task.name,
						target,
					);
					return assessment.eligible && assessment.episode === item.episode;
				})
			) {
				execution.save({
					...item,
					state: "blocked",
					error: "episode_downloading",
				});
				return null;
			}
			const source = await resolveTorrent(
				{ downloadUrl: item.source, hash: item.hash },
				this.context.options.transport,
				this.context.signal,
			);
			const probe = await client.probe(this.context.signal);
			await this.destination.validateIncomplete(probe, item.destination);
			this.context.open();
			const before = this.context.options.selection.subscription(item.workKey);
			if (
				!before ||
				before.revision !== subscription.revision ||
				!this.destination.authorized(before)
			)
				return null;
			const choice = this.context.options.selection
				.candidates(item.workKey)
				.find(
					(candidate) =>
						candidate.id === item.candidateId &&
						candidate.episode === item.episode &&
						candidate.status === "selected",
				);
			if (!choice) {
				execution.save({
					...item,
					state: "blocked",
					error: "selection_changed",
				});
				return null;
			}
			item = execution.save({
				...item,
				state: "submitting",
				attempts: item.attempts + 1,
				subscriptionRevision: before.revision,
				error: null,
			});
			try {
				await client.add(
					{
						source: source.source,
						savePath: posix.join(item.destination.path, item.directory),
						category: "anishelf",
						tags: [`anishelf-${item.id}`],
					},
					this.context.signal,
				);
			} catch (error) {
				if (error instanceof QbittorrentError && error.outcome !== "unknown")
					throw error;
				execution.save({
					...item,
					state: "unknown",
					error: "submission_unconfirmed",
					nextAttemptAt: this.context.now() + policy.activeIntervalMs,
				});
				return null;
			}
			task = await client.task(item.hash, this.context.signal);
			if (!task) {
				execution.save({
					...item,
					state: "unknown",
					error: "submission_unconfirmed",
				});
				return null;
			}
		}
		if (
			task.category !== "anishelf" ||
			!task.tags.includes(`anishelf-${item.id}`)
		) {
			execution.save({
				...item,
				state: "blocked",
				error: "external_task_conflict",
			});
			return null;
		}
		if (
			absoluteDownloadPath(task.savePath) !==
			posix.join(item.destination.path, item.directory)
		)
			throw new DownloadError("task_path_changed");
		item = execution.save({
			...item,
			state: "bound",
			transfer: task.state,
			progress: task.progress,
			observedAt: this.context.now(),
			error: ["failed", "review"].includes(item.ingestion) ? item.error : null,
			nextAttemptAt: 0,
		});

		return { item, task };
	}
}
