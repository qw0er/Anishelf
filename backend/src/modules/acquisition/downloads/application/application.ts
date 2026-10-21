import type { AcquisitionTarget } from "../../../anime/public.js";
import type { DownloadsApi } from "../public.js";
import { DownloadActivityQueries } from "./activity.js";
import { DownloadCommands } from "./commands.js";
import { DownloadContext, type DownloadOptions } from "./context.js";
import { DownloadDestinationSettings } from "./destination.js";
import { DownloadImport } from "./import.js";
import { DownloadReconciliation } from "./reconciliation.js";
import { DownloadReservations } from "./reservations.js";
import { DownloadSubmission } from "./submission.js";
import { DownloadWorker } from "./worker.js";

/** Internal facade; external capabilities and worker lifecycle remain independently selected. */
export class DownloadsApplication implements DownloadsApi {
	private readonly destination: DownloadDestinationSettings;
	private readonly commands: DownloadCommands;
	private readonly queries: DownloadActivityQueries;
	private readonly worker: DownloadWorker;
	constructor(options: DownloadOptions) {
		const context = new DownloadContext(options);
		this.destination = new DownloadDestinationSettings(context);
		this.commands = new DownloadCommands(context, this.destination);
		this.queries = new DownloadActivityQueries(context, this.destination);
		this.worker = new DownloadWorker(
			context,
			new DownloadReservations(context, this.destination),
			new DownloadReconciliation(
				context,
				this.destination,
				new DownloadSubmission(context, this.destination),
				new DownloadImport(context),
			),
		);
	}
	settings() {
		return this.destination.settings();
	}
	saveDestination(input: Parameters<DownloadsApi["saveDestination"]>[0]) {
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
	retry(...args: Parameters<DownloadsApi["retry"]>) {
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
