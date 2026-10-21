import type { AcquisitionTarget } from "../../anime/public.js";
import { DownloadsApplication } from "../downloads/application/application.js";
import type { AcquisitionDownloadsApi } from "../public.js";
import { DownloadActivityQueries } from "./activity.js";
import { SubmissionAdmission } from "./admission.js";
import { DownloadCommands } from "./commands.js";
import { AcquisitionContext, type AcquisitionOptions } from "./context.js";
import { DownloadDestinationSettings } from "./destination.js";
import { CompletedDownloadIngestion } from "./import.js";
import { AcquisitionReconciliation } from "./reconciliation.js";
import { DownloadPlanning } from "./reservations.js";
import { AcquisitionWorker } from "./worker.js";

/** Internal facade; external capabilities and worker lifecycle remain independently selected. */
export class AcquisitionApplication implements AcquisitionDownloadsApi {
	private readonly destination: DownloadDestinationSettings;
	private readonly commands: DownloadCommands;
	private readonly queries: DownloadActivityQueries;
	private readonly worker: AcquisitionWorker;
	constructor(options: AcquisitionOptions) {
		const context = new AcquisitionContext(options);
		this.destination = new DownloadDestinationSettings(context);
		this.commands = new DownloadCommands(context, this.destination);
		this.queries = new DownloadActivityQueries(context, this.destination);
		this.worker = new AcquisitionWorker(
			context,
			new DownloadPlanning(context, this.destination),
			new AcquisitionReconciliation(
				context,
				this.destination,
				new DownloadsApplication(
					context,
					new SubmissionAdmission(context, this.destination),
				),
				new CompletedDownloadIngestion(context),
			),
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
	preview(key: string, target: AcquisitionTarget) {
		return this.destination.preview(key, target);
	}
	authorizeSubscription(
		workKey: string,
		revision: string,
		destinationRevision: string,
	) {
		this.destination.authorize(workKey, revision, destinationRevision);
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
