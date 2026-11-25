import { posix } from "node:path";
import { DownloadError } from "../domain/model.js";
import { relativeDownloadPath } from "../domain/paths.js";
import type { CompletedDownload } from "../public.js";
import type {
	DownloadApplicationContext,
	DownloadExecution,
} from "./context.js";
import { ManifestDownloadIngestion } from "./manifest-import.js";

export class CompletedDownloadIngestion {
	private readonly manifest: ManifestDownloadIngestion;
	constructor(private readonly context: DownloadApplicationContext) {
		this.manifest = new ManifestDownloadIngestion(context);
	}
	reconcileReview(execution: DownloadExecution) {
		return this.manifest.reconcileReview(execution);
	}
	async run(execution: DownloadExecution, completed: CompletedDownload) {
		if (completed.manifest)
			return this.manifest.run(execution, completed.manifest, completed);
		let item = execution.current;
		const legacyReview = item.ingestion === "review";
		if (
			item.ingestion === "failed" ||
			(legacyReview &&
				(item.acceptedTarget || item.error !== "association_requires_review"))
		)
			return;
		const files = completed.files;
		const selected = files.filter((file) => file.selected);
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
		const paths = new Set<string>();
		const indices = new Set<number>();
		for (const file of files) {
			const relativePath = relativeDownloadPath(file.path);
			if (
				paths.has(relativePath) ||
				!Number.isSafeInteger(file.sizeBytes) ||
				file.sizeBytes < 0 ||
				(file.index !== undefined &&
					(!Number.isSafeInteger(file.index) ||
						file.index < 0 ||
						indices.has(file.index)))
			)
				throw new DownloadError("download_changed");
			paths.add(relativePath);
			if (file.index !== undefined) indices.add(file.index);
		}
		const path = relativeDownloadPath(posix.join(item.directory, video.path));
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
		if (
			item.sourceIdentity &&
			(item.sourceIdentity.fileId !== identity.fileId ||
				item.sourceIdentity.sourceVersion !== identity.sourceVersion)
		)
			throw new DownloadError("source_changed");
		if (
			legacyReview &&
			!(await this.context.options.ingestion.recoverableReview?.(identity))
		) {
			execution.save({
				...item,
				ingestion: "review",
				error: "association_requires_manual_review",
			});
			return;
		}
		if (!item.acceptedTarget && this.context.options.ingestion.captureTarget) {
			const acceptedTarget = await this.context.options.ingestion.captureTarget(
				item.workKey,
				item.episode,
				this.context.signal,
			);
			item = execution.save({ ...item, acceptedTarget });
		}
		const observation = (file: (typeof files)[number]) => ({
			index: file.index ?? null,
			path: file.path,
			sizeBytes: file.sizeBytes,
			selected: file.selected,
		});
		item = execution.save(
			{ ...item, sourceIdentity: identity },
			{
				video: observation(video),
				selection: files.map(observation),
			},
		);
		const outcome = await this.context.options.ingestion.ingest(
			item.workKey,
			item.episode,
			identity,
			this.context.signal,
			...(item.acceptedTarget
				? [
						{
							intentId: item.id,
							candidateId: item.candidateId,
							title: item.title,
							hash: item.hash,
							transfer: item.transfer,
							target: item.acceptedTarget,
							warnings: [],
						},
					]
				: []),
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
