import { posix } from "node:path";
import type { DownloadTask, QbittorrentApi } from "../qbittorrent/public.js";
import type { DownloadContext, DownloadExecution } from "./context.js";
import { DownloadError } from "./domain/model.js";
import { relativeDownloadPath } from "./domain/paths.js";

export class DownloadImport {
	constructor(private readonly context: DownloadContext) {}
	async run(
		execution: DownloadExecution,
		task: DownloadTask,
		client: QbittorrentApi,
	) {
		let item = execution.current;
		if (
			task.progress !== 1 ||
			task.remainingBytes !== 0 ||
			/checking|moving|meta|error|missing/i.test(task.state)
		)
			return;
		if (item.ingestion === "review" || item.ingestion === "failed") return;
		const files = await client.files(item.hash, this.context.signal);
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
		const completed = await client.task(item.hash, this.context.signal),
			finalFiles = await client.files(item.hash, this.context.signal);
		if (
			completed?.progress !== 1 ||
			completed.remainingBytes !== 0 ||
			completed.savePath !== task.savePath ||
			JSON.stringify(finalFiles) !== JSON.stringify(files)
		)
			throw new DownloadError("download_changed");
		const outcome = await this.context.options.ingestion.ingest(
			item.workKey,
			item.episode,
			identity,
			this.context.signal,
		);
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
