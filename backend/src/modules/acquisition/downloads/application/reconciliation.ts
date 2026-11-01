import { TorrentError } from "../../torrent-clients/public.js";
import { DownloadError, type DownloadIntent } from "../public.js";
import type { DownloadTransfers } from "../transfers/application.js";
import type { DownloadApplicationContext } from "./context.js";
import { DownloadExecution } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import type { CompletedDownloadIngestion } from "./import.js";
import type { OneOffDownloads } from "./one-off.js";
export class DownloadReconciliation {
	constructor(
		private readonly context: DownloadApplicationContext,
		private readonly destination: DownloadDestinationSettings,
		private readonly downloads: DownloadTransfers,
		private readonly importer: CompletedDownloadIngestion,
		private readonly oneOff: OneOffDownloads,
	) {}
	async run(item: DownloadIntent) {
		const execution = new DownloadExecution(this.context, item);
		if (item.state === "discovering") {
			await this.oneOff.discover(execution);
			item = execution.current;
		}
		if (
			item.state === "pending" &&
			item.origin === "one-off" &&
			!this.oneOff.authorized(item)
		) {
			execution.save({
				...item,
				state: "blocked",
				error: "acquisition_configuration_changed",
			});
			return;
		}
		if (item.state === "pending" && item.origin === "subscription") {
			const subscription = this.context.options.selection.subscription(
				item.workKey,
			);
			if (!subscription || !this.destination.authorized(subscription)) return;
		}
		if (
			item.nextAttemptAt > this.context.now() ||
			["discovering", "missing", "blocked"].includes(item.state)
		)
			return;
		try {
			const completed = await this.downloads.run(execution);
			if (completed) await this.importer.run(execution, completed);
		} catch (error) {
			if (this.context.signal.aborted) return;
			const current = this.context.options.store.intent(item.id);
			if (!current || current.revision !== execution.current.revision) return;
			if (
				current.origin === "one-off" &&
				current.state === "pending" &&
				!this.oneOff.authorized(current)
			) {
				execution.save({
					...current,
					state: "blocked",
					error: "acquisition_configuration_changed",
				});
				return;
			}
			const code =
				error instanceof DownloadError
					? error.code
					: error instanceof TorrentError
						? `downloader_${error.code}`
						: "verification_unavailable";
			execution.save({
				...current,
				state:
					current.state === "submitting"
						? error instanceof TorrentError &&
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
