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
	private readonly destination: DownloadDestinationSettings;
	private readonly commands: DownloadCommands;
	private readonly queries: DownloadActivityQueries;
	private readonly worker: DownloadWorker;
	constructor(options: DownloadApplicationOptions) {
		const context = new DownloadContext(options);
		this.destination = new DownloadDestinationSettings(context);
		this.commands = new DownloadCommands(context, this.destination);
		this.queries = new DownloadActivityQueries(context, this.destination);
		this.worker = new DownloadWorker(
			context,
			new DownloadPlanning(context, this.destination),
			new DownloadReconciliation(
				context,
				this.destination,
				new DownloadTransfers(
					context,
					new SubmissionAdmission(context, this.destination),
				),
				new CompletedDownloadIngestion(context),
			),
			this.destination,
		);
	}
	settings() {
		return this.destination.settings();
	}
	saveDestination(
		input: Parameters<AcquisitionDownloadsApi["saveDestination"]>[0],
	) {
		return this.destination.saveDestination(input);
	}
	validate(revision: string) {
		return this.destination.validate(revision);
	}
	activity(workKey: string, page = 1) {
		return this.queries.activity(workKey, page);
	}
	retry(...args: Parameters<AcquisitionDownloadsApi["retry"]>) {
		this.commands.retry(...args);
	}
	tick() {
		return this.worker.tick();
	}
	start() {
		this.worker.start();
	}
	close() {
		return this.worker.close();
	}
}
