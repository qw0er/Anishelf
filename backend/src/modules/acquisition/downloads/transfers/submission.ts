import { posix } from "node:path";
import type { TorrentTask } from "../../torrent-clients/public.js";
import {
	type TorrentClient,
	TorrentError,
} from "../../torrent-clients/public.js";
import type {
	DownloadContext,
	DownloadExecution,
} from "../application/context.js";
import { downloadDefaults as policy } from "../defaults.js";
import { DownloadError, type DownloadIntent } from "../domain/model.js";
import { absoluteDownloadPath } from "../domain/paths.js";
import { resolveTorrent } from "../infrastructure/torrent.js";
import type { SubmissionAdmission } from "../ports.js";

export class DownloadSubmission {
	constructor(
		private readonly context: DownloadContext,
		private readonly admission: SubmissionAdmission,
	) {}
	async observe(
		execution: DownloadExecution,
		client: TorrentClient,
		resolvedContent?: Awaited<ReturnType<typeof resolveTorrent>>,
	): Promise<{ item: DownloadIntent; task: TorrentTask } | null> {
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
			const snapshot = await client.tasks(this.context.signal);
			if (
				snapshot.some((task) =>
					[task.hash, task.v1Hash, task.v2Hash].includes(item.hash),
				)
			) {
				execution.save({
					...item,
					state: "blocked",
					error: "episode_downloading",
				});
				return null;
			}
			const source =
				resolvedContent ??
				(await resolveTorrent(
					{ download: item.source, hash: item.hash },
					this.context.options.transport,
					this.context.signal,
				));
			const subscriptionRevision = await this.admission.authorize(
				execution,
				client,
				snapshot,
			);
			if (subscriptionRevision === null) return null;
			if (!this.context.options.transport.isCurrent(item.source))
				throw new DownloadError("source_changed");
			item = execution.save({
				...item,
				state: "submitting",
				attempts: item.attempts + 1,
				subscriptionRevision,
				error: null,
			});
			this.context.options.logger.info(
				{ event: "acquisition.submission_requested", intentId: item.id },
				"Download submission requested.",
			);
			try {
				await client.add(
					{
						source: source.source,
						savePath: posix.join(item.destination.path, item.directory),
						ownerKey: item.id,
					},
					this.context.signal,
				);
			} catch (error) {
				if (error instanceof TorrentError && error.outcome !== "unknown")
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
		if (task.ownerKey !== item.id) {
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
