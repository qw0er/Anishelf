import { posix } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { AcquisitionReview } from "../../../anime/public.js";
import type { TorrentFile } from "../../torrent-clients/public.js";
import { downloadDefaults } from "../defaults.js";
import {
	DownloadError,
	type DownloadFileObservation,
	type VerifiedDownloadFiles,
} from "../domain/model.js";
import { relativeDownloadPath } from "../domain/paths.js";
import type { CompletedDownload } from "../ports.js";
import type {
	DownloadApplicationContext,
	DownloadExecution,
} from "./context.js";

function observation(file: TorrentFile): DownloadFileObservation {
	return {
		index: file.index ?? null,
		path: file.path,
		sizeBytes: file.sizeBytes,
		selected: file.selected,
	};
}

export class ManifestDownloadIngestion {
	constructor(private readonly context: DownloadApplicationContext) {}

	async reconcileReview(execution: DownloadExecution) {
		const item = execution.current;
		const { ingestion, store } = this.context.options;
		if (
			item.state !== "bound" ||
			item.ingestion !== "review" ||
			!item.transferId ||
			!item.sourceIdentity ||
			!item.acceptedTarget ||
			!ingestion.reviewAcquisition ||
			!store.fileSelection(item.transferId)
		)
			return false;
		const review = await ingestion.reviewAcquisition(
			item.sourceIdentity,
			item.acceptedTarget,
		);
		if (!review) return false;
		this.saveReview(execution, review);
		return true;
	}

	async run(
		execution: DownloadExecution,
		plan: NonNullable<CompletedDownload["manifest"]>,
		completed: CompletedDownload,
	) {
		const { options } = this.context;
		const item = execution.current;
		if (["available", "failed", "review"].includes(item.ingestion)) return;
		const target = item.acceptedTarget;
		const { scopeId, connectionGeneration } = item.destination;
		const filePath = (file: TorrentFile) =>
			relativeDownloadPath(
				posix.join(
					relativeDownloadPath(item.directory),
					relativeDownloadPath(file.path),
				),
			);
		const assertCurrent = () => {
			if (options.connectionGeneration() !== connectionGeneration)
				throw new DownloadError("downloader_configuration_changed");
			if (!plan.isCurrent())
				throw new DownloadError("file_import_selection_changed");
		};
		execution.save({ ...item, ingestion: "validating", error: null });
		options.logger.info(
			{
				event: "acquisition.manifest_import_started",
				intentId: item.id,
				transferId: item.transferId,
				episode: item.episode,
				fileIndex: plan.video.index,
			},
			"Verifying the planned video and its sidecars.",
		);
		try {
			if (!target) throw new DownloadError("release_evidence_changed");
			assertCurrent();
			const path = filePath(plan.video);
			const local = await options.resources.inspect(scopeId, path);
			if (local.sizeBytes !== plan.video.sizeBytes)
				throw new DownloadError("file_size_conflict");
			const identity = await options.resources.refresh(scopeId, path);
			if (
				identity.scopeId !== scopeId ||
				identity.sourceVersion !== local.sourceVersion ||
				(item.sourceIdentity &&
					(item.sourceIdentity.fileId !== identity.fileId ||
						item.sourceIdentity.sourceVersion !== identity.sourceVersion))
			)
				throw new DownloadError("source_changed");

			const sidecars = await Promise.all(
				plan.sidecars.map(async (file) => {
					const relativePath = filePath(file);
					const local = await this.inspectSubtitle(
						scopeId,
						relativePath,
						file.sizeBytes,
					);
					if (file.index === undefined)
						throw new DownloadError("download_changed");
					return {
						index: file.index,
						identity: {
							scopeId,
							relativePath,
							sourceVersion: local.sourceVersion,
						},
						sizeBytes: file.sizeBytes,
					};
				}),
			);
			const verify = async () => {
				assertCurrent();
				if (!(await completed.verify())) {
					assertCurrent();
					throw new DownloadError("download_changed");
				}
				for (const { identity, sizeBytes } of sidecars) {
					const current = await this.inspectSubtitle(
						scopeId,
						identity.relativePath,
						sizeBytes,
					);
					if (current.sourceVersion !== identity.sourceVersion)
						throw new DownloadError("subtitle_source_changed");
				}
				assertCurrent();
			};
			await verify();
			const evidence: VerifiedDownloadFiles = {
				video: observation(plan.video),
				selection: completed.files.map(observation),
			};
			execution.save(
				{ ...execution.current, sourceIdentity: identity },
				evidence,
			);
			const outcome = await options.ingestion.ingest(
				item.workKey,
				item.episode,
				identity,
				this.context.signal,
				{
					intentId: item.id,
					candidateId: item.candidateId,
					title: item.title,
					hash: item.hash,
					transfer: item.transfer,
					target,
					warnings: [],
				},
				{ verify, assertCurrent },
			);
			const review =
				outcome === "review"
					? await options.ingestion.reviewAcquisition?.(identity, target)
					: null;
			assertCurrent();
			const destination = options.store.destination();
			if (
				destination?.revision === item.destination.revision &&
				!destination.visibilityVerified
			)
				options.store.saveDestination({
					...destination,
					visibilityVerified: true,
				});
			const verified = { ...evidence, sidecars };
			if (review) this.saveReview(execution, review, verified);
			else
				execution.save(
					{
						...execution.current,
						state: outcome === "available" ? "available" : "bound",
						ingestion: outcome,
						error: outcome === "review" ? "association_requires_review" : null,
						associationReview: null,
						nextAttemptAt: 0,
					},
					verified,
				);
		} catch (error) {
			const current = execution.current;
			if (
				this.context.signal.aborted ||
				options.store.intent(current.id)?.revision !== current.revision
			)
				return;
			const code =
				error instanceof DownloadError
					? error.code
					: error instanceof DomainError && error.code === "CATALOG_CONFLICT"
						? "association_conflict_retry"
						: "verification_unavailable";
			const retry =
				code === "file_import_selection_changed" ||
				code === "association_conflict_retry";
			execution.save({
				...current,
				ingestion: retry ? "pending" : "failed",
				error: code,
				attempts: current.attempts + 1,
				nextAttemptAt: retry
					? this.context.now() + downloadDefaults.activeIntervalMs
					: 0,
			});
			options.logger.warn(
				{
					event: "acquisition.manifest_import_interrupted",
					intentId: current.id,
					transferId: current.transferId,
					episode: current.episode,
					fileIndex: plan.video.index,
					code,
					retry,
				},
				"Manifest video import could not be completed.",
			);
		}
	}

	private async inspectSubtitle(
		scopeId: string,
		path: string,
		sizeBytes: number,
	) {
		const { resources } = this.context.options;
		let local:
			| Awaited<ReturnType<NonNullable<typeof resources.inspectSubtitle>>>
			| undefined;
		try {
			local = await resources.inspectSubtitle?.(scopeId, path);
		} catch {
			throw new DownloadError("subtitle_file_unavailable");
		}
		if (!local) throw new DownloadError("subtitle_file_unavailable");
		if (local.sizeBytes !== sizeBytes)
			throw new DownloadError("subtitle_size_conflict");
		return local;
	}

	private saveReview(
		execution: DownloadExecution,
		review: AcquisitionReview,
		evidence?: VerifiedDownloadFiles,
	) {
		const item = execution.current;
		if (review.disposition === "available") {
			execution.save(
				{
					...item,
					state: "available",
					ingestion: "available",
					associationReview: null,
					error: null,
					nextAttemptAt: 0,
				},
				evidence,
			);
			return;
		}
		let error = "association_requires_review";
		if (review.disposition === "rejected") error = "association_rejected";
		else if (
			review.disposition === "protected" &&
			item.associationReview?.id === review.id &&
			item.associationReview.decisionKey !== review.decisionKey
		)
			error = "association_reassigned";
		execution.save(
			{
				...item,
				state: error === "association_requires_review" ? "bound" : "blocked",
				ingestion: "review",
				associationReview: review,
				error,
				nextAttemptAt: 0,
			},
			evidence,
		);
	}
}
