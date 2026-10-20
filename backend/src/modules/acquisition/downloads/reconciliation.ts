import { QbittorrentError } from "../qbittorrent/public.js";
import { type DownloadContext, DownloadExecution } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import { DownloadError, type DownloadIntent } from "./domain/model.js";
import type { DownloadImport } from "./import.js";
import { resolveTorrent } from "./infrastructure/torrent.js";
import type { DownloadSubmission } from "./submission.js";

export class DownloadReconciliation {
	constructor(
		private readonly context: DownloadContext,
		private readonly destination: DownloadDestinationSettings,
		private readonly submission: DownloadSubmission,
		private readonly importer: DownloadImport,
	) {}
	async run(item: DownloadIntent) {
		const execution = new DownloadExecution(this.context, item);
		if (item.state === "pending") {
			const subscription = this.context.options.selection.subscription(
				item.workKey,
			);
			if (!subscription || !this.destination.authorized(subscription)) return;
		}
		if (
			item.nextAttemptAt > this.context.now() ||
			["missing", "blocked"].includes(item.state)
		)
			return;
		try {
			if (item.state === "available") {
				if (
					item.sourceIdentity &&
					(await this.context.options.ingestion.available(
						item.workKey,
						item.episode,
						item.sourceIdentity,
					))
				)
					return;
				execution.save({
					...item,
					state: "bound",
					ingestion: "review",
					error: "association_changed",
				});
				return;
			}
			if (
				item.destination.connectionGeneration !==
				this.context.options.connectionGeneration()
			) {
				execution.save({
					...item,
					state: "blocked",
					error: "downloader_configuration_changed",
				});
				return;
			}
			if (item.hash.startsWith("unresolved:")) {
				const resolved = await resolveTorrent(
					{ downloadUrl: item.source, hash: item.expectedHash },
					this.context.options.transport,
					this.context.signal,
				);
				if (this.context.options.store.hashOwner(resolved.hash, item.id)) {
					execution.save({
						...item,
						state: "blocked",
						error: "torrent_reserved",
					});
					return;
				}
				item = execution.save({ ...item, hash: resolved.hash });
			}
			await this.context.options.withClient(
				item.destination.connectionGeneration,
				async (client) => {
					const observed = await this.submission.observe(execution, client);
					if (observed) {
						item = observed.item;
						await this.importer.run(execution, observed.task, client);
					}
				},
			);
		} catch (error) {
			if (this.context.signal.aborted) return;
			const current = this.context.options.store.intent(item.id);
			if (!current || current.revision !== execution.current.revision) return;
			const code =
				error instanceof DownloadError
					? error.code
					: error instanceof QbittorrentError
						? `downloader_${error.code}`
						: "verification_unavailable";
			execution.save({
				...current,
				state:
					current.state === "submitting"
						? error instanceof QbittorrentError &&
							error.outcome !== "unknown" &&
							error.outcome !== "read"
							? "pending"
							: "unknown"
						: current.state === "available"
							? "bound"
							: current.state,
				ingestion:
					current.ingestion === "validating" ||
					current.ingestion === "available"
						? "failed"
						: current.ingestion,
				error: code,
				attempts: current.attempts + 1,
				nextAttemptAt:
					this.context.now() + this.context.delay(current.attempts + 1),
			});
		}
	}
}
