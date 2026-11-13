import type {
	DownloadContext,
	DownloadExecution,
} from "../application/context.js";
import { isTorrentComplete } from "../domain/completion.js";
import { resolveTorrent } from "../infrastructure/torrent.js";
import type { CompletedDownload, SubmissionAdmission } from "../ports.js";
import { DownloadSubmission } from "./submission.js";
/** Executes accepted tasks; no Discovery, Anime or Resources business calls. */
export class DownloadTransfers {
	private readonly submission: DownloadSubmission;
	constructor(
		private readonly context: DownloadContext,
		admission: SubmissionAdmission,
	) {
		this.submission = new DownloadSubmission(context, admission);
	}
	async run(execution: DownloadExecution): Promise<CompletedDownload | null> {
		let item = execution.current;
		let resolvedContent: Awaited<ReturnType<typeof resolveTorrent>> | undefined;
		if (
			item.destination.connectionGeneration !==
			this.context.options.connectionGeneration()
		) {
			execution.save({
				...item,
				state: "blocked",
				error: "downloader_configuration_changed",
			});
			return null;
		}
		if (item.hash.startsWith("unresolved:")) {
			const resolved = await resolveTorrent(
				{ download: item.source, hash: item.expectedHash },
				this.context.options.transport,
				this.context.signal,
			);
			if (this.context.options.store.hashOwner(resolved.hash, item.id)) {
				execution.save({
					...item,
					state: "blocked",
					error: "torrent_reserved",
				});
				return null;
			}
			item = execution.save({ ...item, hash: resolved.hash });
			resolvedContent = resolved;
		}
		return this.context.options.withClient(
			item.destination.connectionGeneration,
			async (client) => {
				const observed = await this.submission.observe(
					execution,
					client,
					resolvedContent,
				);
				if (!observed) return null;
				const task = observed.task;
				if (!isTorrentComplete(task)) return null;
				const files = await client.files(item.hash, this.context.signal);
				return {
					task,
					files,
					verify: async () =>
						this.context.options.withClient(
							item.destination.connectionGeneration,
							async (currentClient) => {
								const current = await currentClient.task(
									item.hash,
									this.context.signal,
								);
								const currentFiles = await currentClient.files(
									item.hash,
									this.context.signal,
								);
								return (
									current !== null &&
									isTorrentComplete(current) &&
									current.ownerKey === item.id &&
									current.savePath === task.savePath &&
									JSON.stringify(currentFiles) === JSON.stringify(files)
								);
							},
						),
				};
			},
		);
	}
}
