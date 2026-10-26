import type { AcquisitionDownloadsApi } from "../../public.js";
import { DownloadTransfers } from "../transfers/application.js";
import { DownloadActivityQueries } from "./activity.js";
import { SubmissionAdmission } from "./admission.js";
import { DownloadCommands } from "./commands.js";
import { type DownloadApplicationOptions, DownloadContext } from "./context.js";
import { DownloadDestinationSettings } from "./destination.js";
import { CompletedDownloadIngestion } from "./import.js";
import { DownloadReconciliation } from "./reconciliation.js";
import { DownloadPlanning } from "./reservations.js";
import { DownloadWorker } from "./worker.js";

/** Internal facade; external capabilities and worker lifecycle remain independently selected. */
export class DownloadsApplication implements AcquisitionDownloadsApi {
	readonly settings: AcquisitionDownloadsApi["settings"];
	readonly saveDestination: AcquisitionDownloadsApi["saveDestination"];
	readonly validate: AcquisitionDownloadsApi["validate"];
	readonly summary: AcquisitionDownloadsApi["summary"];
	readonly activity: AcquisitionDownloadsApi["activity"];
	readonly retry: AcquisitionDownloadsApi["retry"];
	readonly tick: DownloadWorker["tick"];
	readonly start: DownloadWorker["start"];
	readonly close: DownloadWorker["close"];
	constructor(options: DownloadApplicationOptions) {
		const context = new DownloadContext(options);
		const destination = new DownloadDestinationSettings(context);
		const commands = new DownloadCommands(context, destination);
		const queries = new DownloadActivityQueries(context, destination);
		const worker = new DownloadWorker(
			context,
			new DownloadPlanning(context, destination),
			new DownloadReconciliation(
				context,
				destination,
				new DownloadTransfers(
					context,
					new SubmissionAdmission(context, destination),
				),
				new CompletedDownloadIngestion(context),
			),
			destination,
		);
		this.settings = destination.settings.bind(destination);
		this.saveDestination = destination.saveDestination.bind(destination);
		this.validate = destination.validate.bind(destination);
		this.summary = queries.summary.bind(queries);
		this.activity = queries.activity.bind(queries);
		this.retry = commands.retry.bind(commands);
		this.tick = worker.tick.bind(worker);
		this.start = worker.start.bind(worker);
		this.close = worker.close.bind(worker);
	}
}
