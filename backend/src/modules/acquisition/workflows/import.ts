import { posix } from "node:path";
import type { DownloadExecution } from "../downloads/application/context.js";
import { DownloadError } from "../downloads/domain/model.js";
import { relativeDownloadPath } from "../downloads/domain/paths.js";
import type { CompletedDownload } from "../downloads/public.js";
import type { AcquisitionContext } from "./context.js";

export class CompletedDownloadIngestion {
	constructor(private readonly context: AcquisitionContext) {}
	async run(execution: DownloadExecution, completed: CompletedDownload) {
		let item = execution.current;
		if (["review", "failed"].includes(item.ingestion)) return;
		const files = completed.files;
		const selected = files.filter((file) => file.priority > 0);
		const videos = selected.filter((file) =>
			/\.(?:mkv|mp4|m4v|webm|avi|mov|ts|m2ts|mpg|mpeg)$/i.test(file.path),
		);
		if (
			videos.length !== 1 ||
			!selected.length ||
			selected.some((file) => file.progress !== 1) ||
			videos[0]?.sizeBytes === 0
		) {
			execution.save({
				...item,
				ingestion: "review",
				error: "unsupported_file_layout",
			});
			return;
		}
		const video = videos[0];
		if (!video) return;
		for (const file of files) relativeDownloadPath(file.path);
		const path = relativeDownloadPath(
			posix.join(item.directory, relativeDownloadPath(video.path)),
		);
		if (item.ingestion !== "available")
			this.context.options.logger.info(
				{
					event: "acquisition.ingestion_requested",
					intentId: item.id,
					workKey: item.workKey,
				},
				"Completed download handed to resource verification and Anime ingestion.",
			);
		item = execution.save({ ...item, ingestion: "validating" });
		const inspected = await this.context.options.resources.inspect(
			item.destination.scopeId,
			path,
		);
		if (inspected.sizeBytes !== video.sizeBytes)
			throw new DownloadError("file_size_conflict");
		const identity = await this.context.options.resources.refresh(
			item.destination.scopeId,
			path,
		);
		if (identity.sourceVersion !== inspected.sourceVersion)
			throw new DownloadError("source_changed");
		if (!(await completed.verify()))
			throw new DownloadError("download_changed");
		const outcome = await this.context.options.ingestion.ingest(
			item.workKey,
			item.episode,
			identity,
			this.context.signal,
		);
		if (
			item.destination.connectionGeneration !==
			this.context.options.connectionGeneration()
		)
			throw new DownloadError("downloader_configuration_changed");
		const destination = this.context.options.store.destination();
		if (destination?.revision === item.destination.revision)
			this.context.options.store.saveDestination({
				...destination,
				visibilityVerified: true,
			});
		execution.save({
			...item,
			sourceIdentity: identity,
			state: outcome === "available" ? "available" : "bound",
			ingestion: outcome,
			error: outcome === "review" ? "association_requires_review" : null,
		});
	}
}
