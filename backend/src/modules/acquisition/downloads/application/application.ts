import type { AcquisitionDownloadsApi } from "../../public.js";
import { DownloadTransfers } from "../transfers/application.js";
import { DownloadActivityQueries } from "./activity.js";
import { SubmissionAdmission } from "./admission.js";
import { DownloadCommands } from "./commands.js";
import { type DownloadApplicationOptions, DownloadContext } from "./context.js";
import { DownloadDestinationSettings } from "./destination.js";
import { CompletedDownloadIngestion } from "./import.js";
import { OneOffDownloads } from "./one-off.js";
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
	readonly requestEpisode: AcquisitionDownloadsApi["requestEpisode"];
	readonly retry: AcquisitionDownloadsApi["retry"];
	readonly tick: DownloadWorker["tick"];
	readonly start: DownloadWorker["start"];
	readonly close: DownloadWorker["close"];
	constructor(options: DownloadApplicationOptions) {
		const context = new DownloadContext(options);
		const destination = new DownloadDestinationSettings(context);
		const oneOff = new OneOffDownloads(context);
		const commands = new DownloadCommands(context, destination, oneOff);
		const queries = new DownloadActivityQueries(context, destination, oneOff);
		const worker = new DownloadWorker(
			context,
			new DownloadPlanning(context, destination),
			new DownloadReconciliation(
				context,
				destination,
				new DownloadTransfers(
					context,
					new SubmissionAdmission(context, destination, oneOff),
				),
				new CompletedDownloadIngestion(context),
				oneOff,
			),
			destination,
		);
		this.settings = destination.settings.bind(destination);
		this.saveDestination = destination.saveDestination.bind(destination);
		this.validate = destination.validate.bind(destination);
		this.summary = queries.summary.bind(queries);
		this.activity = queries.activity.bind(queries);
		this.retry = (id, revision, commandId, kind) => {
			commands.retry(id, revision, commandId, kind);
			worker.wake();
		};
		this.requestEpisode = async (input) => {
			const result = await oneOff.accept(input);
			worker.wake();
			return result;
		};
		this.tick = worker.tick.bind(worker);
		this.start = worker.start.bind(worker);
		this.close = worker.close.bind(worker);
	}
}
