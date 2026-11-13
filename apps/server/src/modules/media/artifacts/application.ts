import PQueue from "p-queue";
import type { PreparedMediaItem } from "../../../contracts/http.js";
import { MediaToolError } from "../../../platform/media/errors.js";
import type { MediaExecutionProgress } from "../../../platform/media/events.js";
import { DomainError } from "../../../shared/errors.js";
import type { ResolvedSource } from "../../resources/public.js";
import type { ProcessedMedia } from "../preparation/execution/public.js";
import type {
	PreparationFailureReason,
	PreparationTask,
	PreparationView,
	PreparedArtifact,
} from "../preparation/public.js";
import type { ArtifactContext } from "./public.js";

import { InvalidPreparedMediaError } from "./public.js";

/** Only operations on the same artifact serialize. Planning and task control never acquire this gate. */
export class PreparationArtifacts {
	private readonly inspections = new PQueue({ concurrency: 1 });
	private readonly gates = new Map<string, Promise<unknown>>();
	private readonly borrowers = new Map<
		string,
		{ count: number; bytes: number }
	>();
	constructor(private readonly context: ArtifactContext) {}
	private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const result = (this.gates.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(operation);
		const tail = result.catch(() => {});
		this.gates.set(id, tail);
		void tail.finally(() => {
			if (this.gates.get(id) === tail) this.gates.delete(id);
		});
		return result;
	}
	private view(task: PreparationTask): PreparationView {
		const artifact =
			task.state.status === "ready"
				? (this.context.repository.artifact(task.spec.executionPlanId) ?? null)
				: null;
		return {
			task,
			artifact,
			availability: artifact?.info
				? this.context.sources.hasSnapshot
					? "ready"
					: "unknown"
				: "unavailable",
		};
	}
	assertUnborrowed(id: string): void {
		if (this.borrowers.has(id))
			throw new DomainError(
				"PREPARATION_BUSY",
				"This prepared media is still in use.",
			);
	}
	retainedBytes(): number {
		let bytes = this.context.repository.artifactBytes();
		for (const [id, borrowed] of this.borrowers)
			if (!this.context.repository.artifact(id)) bytes += borrowed.bytes;
		return bytes;
	}
	private async discard(
		task: PreparationTask,
		reason: PreparationFailureReason,
		progress: MediaExecutionProgress | null = task.state.progress,
	): Promise<void> {
		// Prevent new readers before deleting, retaining bytes until the last current reader releases.
		task.state = {
			status: "failed",
			failureReason: reason,
			progress,
			updatedAtMs: Date.now(),
		};
		this.context.repository.removeArtifact(task);
		if (!this.borrowers.has(task.spec.executionPlanId))
			await this.context.files.remove(task.spec.executionPlanId);
	}
	invalidate(
		task: PreparationTask,
		reason: PreparationFailureReason,
	): Promise<void> {
		return this.exclusive(task.spec.executionPlanId, () =>
			this.discard(this.context.required(task.id), reason),
		);
	}
	/** Inspect persisted paths so a refreshed catalog cannot hide deleted sources. */
	async cleanupMissingSources(): Promise<void> {
		if (this.context.closed || !this.context.sources.hasSnapshot) return;
		for (const artifact of this.context.repository.artifacts()) {
			if (this.context.closed) break;
			try {
				await this.exclusive(artifact.id, async () => {
					if (
						this.context.closed ||
						!this.context.repository.artifact(artifact.id)
					)
						return;
					const task = this.context.required(artifact.taskId);
					if (task.state.status !== "ready") return;
					const expected = {
						identity: task.spec.source,
						accessRevision: this.context.sources.accessRevision,
					};
					// Root failures must never count as a missing individual file.
					const resources = await this.context.sources.openResources(expected);
					try {
						await resources.inspectVideoFile(task.spec.source.relativePath);
					} catch (error) {
						if (
							!(error instanceof DomainError) ||
							error.code !== "RESOURCE_MISSING"
						)
							throw error;
						await this.context.sources.openResources(expected);
						this.context.sources.assertAccessRevision(expected.accessRevision);
						if (this.context.closed) return;
						await this.discard(task, "source-changed");
						this.context.logger.info(
							{
								event: "preparation.orphan_cleaned",
								taskId: task.id,
								artifactId: artifact.id,
							},
							"Prepared copy invalidated because its source file is missing.",
						);
					}
				});
			} catch (error) {
				this.context.logger.warn(
					{
						event: "preparation.cleanup_deferred",
						artifactId: artifact.id,
						errorName: error instanceof Error ? error.name : "unknown",
					},
					"Prepared copy cleanup could not complete.",
				);
			}
		}
	}
	private async validate(task: PreparationTask): Promise<PreparationTask> {
		if (task.state.status !== "ready") return task;
		let source: ResolvedSource | undefined;
		if (this.context.sources.hasSnapshot) {
			try {
				source = await this.context.source(task);
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				await this.discard(task, this.context.failure(error));
				return task;
			}
		}
		const artifact = this.context.repository.artifact(
			task.spec.executionPlanId,
		);
		if (!artifact) {
			await this.discard(task, "cache-missing");
			return task;
		}
		try {
			const handle = await this.context.files.open(artifact);
			await handle.close();
			if (!artifact.info) {
				const info = await this.inspections.add(() =>
					this.context.files.inspect(artifact, this.context.probe),
				);
				if (!info)
					throw new MediaToolError(
						"TOOL_FAILED",
						"Prepared media inspection did not return a description.",
					);
				this.context.repository.saveArtifactInfo(artifact.id, info);
				this.context.logger.info(
					{ event: "preparation.artifact_inspected", artifactId: artifact.id },
					"Prepared media description recovered from the existing file.",
				);
			}
		} catch (error) {
			if (error instanceof MediaToolError) {
				this.context.logger.debug(
					{
						event: "preparation.artifact_inspection_deferred",
						artifactId: artifact.id,
					},
					"Existing prepared media retained until output inspection is available.",
				);
			} else if (
				!(error instanceof InvalidPreparedMediaError) &&
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			else await this.discard(task, "cache-missing");
		}
		if (task.state.status === "ready" && source) {
			try {
				await this.context.sources.revalidateSource(source);
				this.context.sources.assertAccessRevision(source.accessRevision);
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				await this.discard(task, this.context.failure(error));
			}
		}

		return task;
	}
	async inspect(id: string): Promise<PreparationView> {
		const task = this.context.required(id);
		if (task.state.status !== "ready") return this.view(task);
		return this.exclusive(task.spec.executionPlanId, async () =>
			this.view(await this.validate(this.context.required(id))),
		);
	}
	async open(id: string) {
		return this.exclusive(id, async () => {
			this.context.assertOpen();
			if (!this.context.sources.hasSnapshot)
				throw new DomainError(
					"PREPARATION_UNAVAILABLE",
					"Wait for the library scan before opening prepared media.",
				);
			const artifact = this.context.repository.artifact(id);
			if (!artifact)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			const task = await this.validate(this.context.required(artifact.taskId));
			if (task.state.status !== "ready")
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"Prepared media is no longer valid.",
				);
			const source = await this.context.source(task);
			const handle = await this.context.files.open(artifact);
			try {
				await this.context.sources.revalidateSource(source);
				this.context.sources.assertAccessRevision(source.accessRevision);
				this.context.assertOpen();
			} catch (error) {
				await handle.close();
				throw error;
			}
			const previous = this.borrowers.get(id);
			this.borrowers.set(id, {
				count: (previous?.count ?? 0) + 1,
				bytes: artifact.sizeBytes,
			});
			let released = false;
			return {
				handle,
				path: this.context.files.path(id),
				sizeBytes: artifact.sizeBytes,
				mimeType: artifact.mimeType,
				release: async () => {
					if (released) return;
					released = true;
					try {
						await handle.close();
					} finally {
						await this.exclusive(id, async () => {
							const current = this.borrowers.get(id);
							if (!current) return;
							if (--current.count === 0) {
								this.borrowers.delete(id);
								if (
									!this.context.closed &&
									!this.context.repository.artifact(id)
								)
									await this.context.files.remove(id);
							}
						});
					}
				},
			};
		});
	}
	/** Read-only inventory inspection: never probe, invalidate or remove a copy. */
	managementState(
		artifact: PreparedArtifact,
	): Promise<Pick<PreparedMediaItem, "status" | "deleteBlockedReason"> | null> {
		return this.exclusive(artifact.id, async () => {
			if (!this.context.repository.artifact(artifact.id)) return null;
			const task = this.context.required(artifact.taskId);
			const deleteBlockedReason = this.borrowers.has(artifact.id)
				? ("in-use" as const)
				: ["queued", "processing", "cancelling"].includes(task.state.status)
					? ("active" as const)
					: null;
			let status: PreparedMediaItem["status"] = "unknown";
			try {
				const handle = await this.context.files.open(artifact);
				await handle.close();
				if (this.context.sources.hasSnapshot) {
					await this.context.source(task);
					status =
						artifact.info && task.state.status === "ready"
							? "ready"
							: "unknown";
				}
			} catch (error) {
				status =
					error instanceof InvalidPreparedMediaError ||
					(error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT") ||
					(error instanceof DomainError &&
						[
							"RESOURCE_NOT_FOUND",
							"RESOURCE_MISSING",
							"PLAYBACK_CONFLICT",
						].includes(error.code))
						? "unavailable"
						: "unknown";
			}
			return { status, deleteBlockedReason };
		});
	}
	delete(id: string): Promise<void> {
		return this.exclusive(id, async () => {
			this.context.assertOpen();
			const artifact = this.context.repository.artifact(id);
			if (!artifact)
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			const task = this.context.required(artifact.taskId);
			const epoch = this.context.sources.accessRevision;
			const scope = await this.context.sources.getScope();
			this.context.sources.assertAccessRevision(epoch);
			if (!scope.ids.includes(task.spec.source.scopeId))
				throw new DomainError(
					"RESOURCE_NOT_FOUND",
					"Prepared media not found.",
				);
			if (
				this.borrowers.has(id) ||
				["queued", "processing", "cancelling"].includes(task.state.status)
			)
				throw new DomainError(
					"PREPARATION_BUSY",
					"This prepared media is in use or processing.",
				);
			try {
				await this.context.files.remove(id);
			} catch (error) {
				this.context.logger.warn(
					{
						event: "preparation.delete_failed",
						artifactId: id,
						errorName: error instanceof Error ? error.name : "unknown",
					},
					"Prepared copy deletion failed; its record was retained.",
				);
				throw new DomainError(
					"RESOURCE_WRITE_FAILED",
					"The prepared copy could not be removed.",
				);
			}
			task.state = {
				status: "cancelled",
				failureReason: "cache-deleted",
				progress: task.state.progress,
				updatedAtMs: Date.now(),
			};
			this.context.repository.removeArtifact(task);
			this.context.logger.info(
				{
					event: "preparation.deleted",
					artifactId: id,
					taskId: task.id,
					sizeBytes: artifact.sizeBytes,
				},
				"Prepared copy deleted.",
			);
		});
	}

	publish(
		task: PreparationTask,
		processed: ProcessedMedia,
		minimumFreeBytes: number,
		progress: MediaExecutionProgress | null,
		signal: AbortSignal,
	): Promise<void> {
		return this.exclusive(task.spec.executionPlanId, async () => {
			signal.throwIfAborted();
			this.context.assertOpen();
			if (this.context.required(task.id).state.status !== "processing")
				throw new Error("Preparation stopped before publication.");
			const source = await this.context.source(task);
			if ((await this.context.files.availableBytes()) < minimumFreeBytes)
				throw new DomainError(
					"PREPARATION_STORAGE_FULL",
					"Insufficient free disk storage to publish prepared media.",
				);
			await this.context.files.publish(
				task.spec.executionPlanId,
				processed.output.path,
				processed.sizeBytes,
			);
			await this.context.sources.revalidateSource(source);
			this.context.sources.assertAccessRevision(source.accessRevision);
			signal.throwIfAborted();
			this.context.assertOpen();
			const mimeType = {
				mp4: "video/mp4",
				mov: "video/quicktime",
				webm: "video/webm",
				matroska: "video/x-matroska",
			}[task.spec.settings.plan.container];
			if (!mimeType) throw new Error("Unsupported prepared container.");
			task.state = {
				status: "ready",
				failureReason: null,
				progress,
				updatedAtMs: Date.now(),
			};
			this.context.repository.publish(task, {
				id: task.spec.executionPlanId,
				taskId: task.id,
				delivery: "file",
				sizeBytes: processed.sizeBytes,
				mimeType,
				info: structuredClone(processed.info),
			});
			this.context.logger.info(
				{
					event: "preparation.ready",
					profileId: task.profileId,
					profileFingerprint: task.spec.profileFingerprint,
					taskId: task.id,
					sizeBytes: processed.sizeBytes,
				},
				"Prepared media published.",
			);
		});
	}
	/** Called only after processor cleanup; retry cannot race this attempt's finalization. */
	finishFailure(
		id: string,
		reason: PreparationFailureReason,
		progress: MediaExecutionProgress | null,
	): Promise<void> {
		const task = this.context.required(id);
		return this.exclusive(task.spec.executionPlanId, async () => {
			await this.context.files.remove(task.spec.executionPlanId);
			const current = this.context.required(id);
			current.state =
				current.state.status === "cancelling"
					? {
							status: "cancelled",
							failureReason: "cancelled",
							progress,
							updatedAtMs: Date.now(),
						}
					: {
							status: "failed",
							failureReason: reason,
							progress,
							updatedAtMs: Date.now(),
						};
			this.context.repository.removeArtifact(current);
			this.context.logger.warn(
				{
					event: "preparation.failed",
					profileId: current.profileId,
					profileFingerprint: current.spec.profileFingerprint,
					taskId: id,
					reason: current.state.failureReason,
				},
				"Media preparation did not complete.",
			);
		});
	}
}
