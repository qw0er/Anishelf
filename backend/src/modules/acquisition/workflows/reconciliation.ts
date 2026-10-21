import type { DownloadsApplication } from "../downloads/application/application.js";
import { DownloadExecution } from "../downloads/application/context.js";
import { DownloadError, type DownloadIntent } from "../downloads/public.js";
import { QbittorrentError } from "../qbittorrent/public.js";
import type { AcquisitionContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import type { CompletedDownloadIngestion } from "./import.js";
export class AcquisitionReconciliation {
	constructor(
		private readonly context: AcquisitionContext,
		private readonly destination: DownloadDestinationSettings,
		private readonly downloads: DownloadsApplication,
		private readonly importer: CompletedDownloadIngestion,
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
			const completed = await this.downloads.run(execution);
			if (completed) await this.importer.run(execution, completed);
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
