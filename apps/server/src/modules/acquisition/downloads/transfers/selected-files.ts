import { join } from "node:path";
import { pathContains } from "../../../../platform/paths.js";
import type {
	TorrentClient,
	TorrentFile,
	TorrentTask,
} from "../../torrent-clients/public.js";
import { TorrentError } from "../../torrent-clients/public.js";
import {
	type DownloadContext,
	DownloadExecution,
} from "../application/context.js";
import {
	absoluteDownloadPath,
	sameDownloadPath,
} from "../application/destination-paths.js";
import { downloadDefaults as policy } from "../defaults.js";
import { hasStableTorrentFiles } from "../domain/completion.js";
import {
	observeFileSelection,
	sameManifest,
} from "../domain/file-selection.js";
import {
	DownloadError,
	type DownloadFileObservation,
	type DownloadIntent,
	type ManagedFileSelection,
} from "../domain/model.js";
import { resolveTorrent } from "../infrastructure/torrent.js";
import type { CompletedDownload, SubmissionAdmission } from "../ports.js";

interface RemoteSelection {
	task: TorrentTask;
	files: TorrentFile[];
	observed: DownloadFileObservation[] | null;
}

function matchesPriorities(
	files: readonly DownloadFileObservation[],
	priorities: readonly number[],
) {
	return files.every(
		(file) => file.index !== null && file.priority === priorities[file.index],
	);
}

/** One persisted operation owns the writer slot for a managed torrent. */
export class SelectedFileTransfers {
	constructor(
		private readonly context: DownloadContext,
		private readonly admission: SubmissionAdmission,
	) {}

	async run(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
	): Promise<CompletedDownload | null> {
		const item = execution.current;
		if (selection.pending && selection.pending.requestId !== item.id)
			return null;
		const generation = item.destination.connectionGeneration;
		if (generation !== this.context.options.connectionGeneration()) {
			if (
				selection.pending?.requestId === item.id &&
				selection.pending.sentAt === null
			)
				this.finish(execution, selection, {
					code: "acquisition_configuration_changed",
				});
			else
				execution.save({
					...item,
					state: "blocked",
					error: "downloader_configuration_changed",
				});
			return null;
		}
		if (!selection.owned) {
			execution.save({
				...item,
				state: "missing",
				error: "externally_removed",
			});
			return null;
		}
		return this.context.options.withClient(generation, async (client) => {
			if (!selection.pending)
				return this.completed(execution, selection, client);
			try {
				await this.advance(execution, selection, client);
			} catch (error) {
				if (
					error instanceof DownloadError &&
					[
						"destination_changed",
						"invalid_file_path",
						"metadata_unsupported",
						"source_changed",
						"torrent_identity_conflict",
						"torrent_too_large",
						"unsupported_torrent",
					].includes(error.code)
				) {
					this.finish(execution, selection, { code: error.code });
					return null;
				}
				throw error;
			}
			return null;
		});
	}

	private async advance(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
		client: TorrentClient,
	) {
		const pending = selection.pending;
		if (!pending) return;
		if (
			pending.sentAt === null &&
			!this.authorizedMembers(execution.current, selection)
		) {
			this.finish(execution, selection, {
				code: "acquisition_configuration_changed",
			});
			return;
		}
		let remote: RemoteSelection | null;
		try {
			remote = await this.read(client, selection);
		} catch (error) {
			if (error instanceof DownloadError) {
				this.finish(execution, selection, {
					code: error.code,
					release: error.code === "external_task_conflict",
				});
				return;
			}
			throw error;
		}
		const before =
			selection.observed?.map((file) => file.priority ?? 0) ??
			selection.manifest.files.map(() => 0);
		const added = new Set(pending.added);
		const desired = before.map((priority, index) =>
			added.has(index) ? 1 : priority,
		);
		if (pending.sentAt !== null) {
			if (remote?.observed && matchesPriorities(remote.observed, desired)) {
				this.finish(execution, selection, { remote });
				return;
			}
			if (pending.kind === "add" && !remote?.files.length) {
				this.defer(execution);
				return;
			}
			if (
				remote?.observed &&
				matchesPriorities(remote.observed, before) &&
				this.context.now() < pending.sentAt + policy.idleIntervalMs
			) {
				this.defer(execution);
				return;
			}
		}
		if (pending.kind === "expand" && !remote) {
			this.finish(execution, selection, {
				code: "externally_removed",
				release: true,
			});
			return;
		}
		if (
			pending.kind === "add"
				? remote !== null
				: !remote?.observed || !matchesPriorities(remote.observed, before)
		) {
			this.finish(execution, selection, { code: "file_selection_changed" });
			return;
		}

		const { options } = this.context;
		const item = execution.current;
		const episode = options.store.episodeFileSelection(item.id, selection.id);
		if (!episode || !this.authorizedMembers(item, selection)) {
			this.finish(execution, selection, {
				code: "acquisition_configuration_changed",
			});
			return;
		}
		const snapshot = await client.tasks(this.context.signal);
		let source: Awaited<ReturnType<typeof resolveTorrent>> | undefined;
		if (pending.kind === "add") {
			if (
				snapshot.some((task) =>
					[task.hash, task.v1Hash, task.v2Hash].includes(selection.hash),
				)
			) {
				this.finish(execution, selection, { code: "external_task_conflict" });
				return;
			}
			source = await resolveTorrent(
				{ download: item.source, hash: selection.hash },
				options.transport,
				this.context.signal,
			);
			const staged = await client.inspectMetadata?.(
				{ source: source.source, expectedHash: selection.hash },
				this.context.signal,
			);
			if (!staged || !sameManifest(staged, selection.manifest)) {
				this.finish(execution, selection, {
					code: staged ? "release_evidence_changed" : "metadata_unsupported",
				});
				return;
			}
		}
		const additional = this.additionalMembers(selection).flatMap((item) => {
			const files = options.store.episodeFileSelection(item.id, selection.id);
			return files
				? [{ item, plan: { ...files, manifest: selection.manifest } }]
				: [];
		});
		if (additional.length !== (pending.additionalRequestIds?.length ?? 0)) {
			this.finish(execution, selection, { code: "selection_changed" });
			return;
		}
		const authorized = await this.admission.authorize(
			execution,
			client,
			snapshot,
			{ ...episode, manifest: selection.manifest },
			additional,
		);
		if (!authorized || !this.authorizedMembers(execution.current, selection)) {
			this.finish(execution, selection, {
				code: execution.current.error ?? "acquisition_configuration_changed",
			});
			return;
		}
		try {
			remote = await this.read(client, selection);
		} catch (error) {
			if (error instanceof DownloadError) {
				this.finish(execution, selection, { code: error.code });
				return;
			}
			throw error;
		}
		if (!this.authorizedMembers(execution.current, selection)) {
			this.finish(execution, selection, {
				code: "acquisition_configuration_changed",
			});
			return;
		}
		if (
			pending.kind === "expand" &&
			remote?.observed &&
			matchesPriorities(remote.observed, desired) &&
			(pending.sentAt !== null || pending.added.length === 0)
		) {
			this.finish(execution, selection, { remote });
			return;
		}
		if (
			pending.kind === "add"
				? remote !== null
				: !remote?.observed || !matchesPriorities(remote.observed, before)
		) {
			this.finish(execution, selection, { code: "file_selection_changed" });
			return;
		}
		const sending = options.store.transaction(() => {
			if (!this.current(execution, selection)) return null;
			if (
				!options.store.updateFileSelection({
					transferId: selection.id,
					revision: selection.revision,
					pending: { ...pending, sentAt: this.context.now() },
				})
			)
				return null;
			execution.save({
				...execution.current,
				state: "submitting",
				error: null,
				attempts: execution.current.attempts + 1,
			});
			return options.store.fileSelection(selection.id);
		});
		if (!sending) return;
		options.logger.info(
			{
				event: "acquisition.file_selection_requested",
				intentId: item.id,
				transferId: selection.id,
				revision: sending.revision,
				kind: pending.kind,
				indices: pending.added,
			},
			"Submitted exact torrent file selection.",
		);
		try {
			if (source)
				await client.add(
					{
						source: source.source,
						savePath: this.savePath(selection),
						ownerKey: selection.ownerKey,
						fileSelection: {
							hash: selection.hash,
							...(selection.manifest.v2Hash
								? { v2Hash: selection.manifest.v2Hash }
								: {}),
							priorities: desired.map((priority) => (priority > 0 ? 1 : 0)),
						},
					},
					this.context.signal,
				);
			else
				await client.enableFiles?.(
					remote?.task.hash ?? selection.hash,
					pending.added,
					this.context.signal,
				);
		} catch (error) {
			if (
				error instanceof TorrentError &&
				(error.outcome === "not-sent" || error.outcome === "rejected")
			) {
				this.finish(execution, sending, {
					code: `downloader_${error.code}`,
					release: pending.kind === "add",
				});
				return;
			}
			if (this.current(execution, sending)) this.defer(execution);
			return;
		}
		if (this.current(execution, sending))
			await this.readBack(execution, sending, client, desired);
	}

	private async readBack(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
		client: TorrentClient,
		desired: readonly number[],
	) {
		try {
			const remote = await this.read(client, selection);
			if (remote?.observed && matchesPriorities(remote.observed, desired)) {
				this.finish(execution, selection, { remote });
				return;
			}
		} catch (error) {
			if (error instanceof DownloadError) {
				this.finish(execution, selection, { code: error.code });
				return;
			}
			throw error;
		}
		if (this.current(execution, selection)) this.defer(execution);
	}

	private async completed(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
		client: TorrentClient,
	): Promise<CompletedDownload | null> {
		let remote: RemoteSelection | null;
		try {
			remote = await this.read(client, selection);
		} catch (error) {
			if (!(error instanceof DownloadError)) throw error;
			this.finish(execution, selection, {
				code: error.code,
				release: error.code === "external_task_conflict",
			});
			return null;
		}
		if (!remote) {
			this.finish(execution, selection, {
				code: "externally_removed",
				release: true,
			});
			return null;
		}
		if (
			!remote.observed ||
			JSON.stringify(remote.observed) !== JSON.stringify(selection.observed)
		) {
			this.finish(execution, selection, { code: "file_selection_changed" });
			return null;
		}
		if (!this.current(execution, selection)) return null;
		const { options } = this.context;
		const episode = options.store.episodeFileSelection(
			execution.current.id,
			selection.id,
		);
		if (!episode) return null;
		const selected = new Set([episode.videoIndex, ...episode.subtitleIndices]);
		const files = remote.files.filter(
			(file) => file.index !== undefined && selected.has(file.index),
		);
		const saved = options.store.updateFileSelection({
			transferId: selection.id,
			revision: selection.revision,
			task: remote.task,
			observedAt: this.context.now(),
			fileProgress: files.flatMap(({ index, progress }) =>
				index !== undefined && progress >= 0 && progress <= 1
					? [{ index, progress }]
					: [],
			),
		});
		const video = files.find((file) => file.index === episode.videoIndex);
		if (
			!saved ||
			!video ||
			!this.stableDestination(remote.task, selection) ||
			files.length !== selected.size ||
			files.some((file) => !file.selected || file.progress !== 1)
		)
			return null;
		return {
			task: remote.task,
			files,
			manifest: {
				video,
				sidecars: files.filter((file) => file.index !== video.index),
				isCurrent: () =>
					options.connectionGeneration() ===
						selection.destination.connectionGeneration &&
					this.current(execution, selection),
			},
			verify: () =>
				options.withClient(
					selection.destination.connectionGeneration,
					async (currentClient) => {
						const current = await this.read(currentClient, selection);
						return Boolean(
							current &&
								this.stableDestination(current.task, selection) &&
								this.current(execution, selection) &&
								JSON.stringify(current.observed) ===
									JSON.stringify(remote.observed) &&
								current.files
									.filter(
										(file) =>
											file.index !== undefined && selected.has(file.index),
									)
									.every((file) => file.progress === 1),
						);
					},
				),
		};
	}

	private async read(
		client: TorrentClient,
		selection: ManagedFileSelection,
	): Promise<RemoteSelection | null> {
		const hash = selection.manifest.v2Hash?.slice(0, 40) ?? selection.hash;
		const task = await client.task(hash, this.context.signal);
		if (!task) return null;
		if (
			task.ownerKey !== selection.ownerKey ||
			![task.hash, task.v1Hash].includes(selection.hash) ||
			(selection.manifest.v2Hash && task.v2Hash !== selection.manifest.v2Hash)
		)
			throw new DownloadError("external_task_conflict");
		if (!sameDownloadPath(task.savePath, this.savePath(selection)))
			throw new DownloadError("task_path_changed");
		const files = await client.files(task.hash, this.context.signal);
		const after = await client.task(hash, this.context.signal);
		if (!after) return null;
		if (after.ownerKey !== selection.ownerKey || after.hash !== task.hash)
			throw new DownloadError("external_task_conflict");
		if (!sameDownloadPath(after.savePath, this.savePath(selection)))
			throw new DownloadError("task_path_changed");
		return {
			task: after,
			files,
			observed: observeFileSelection(selection.manifest, files),
		};
	}

	private savePath(selection: ManagedFileSelection) {
		return join(
			absoluteDownloadPath(selection.destination.path),
			selection.directory,
		);
	}

	private stableDestination(
		task: TorrentTask,
		selection: ManagedFileSelection,
	) {
		return (
			hasStableTorrentFiles(task) &&
			Boolean(task.contentPath) &&
			pathContains(
				this.savePath(selection),
				absoluteDownloadPath(task.contentPath),
			)
		);
	}

	private current(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
	) {
		const { options } = this.context;
		const item = execution.current;
		return (
			!this.context.signal.aborted &&
			options.store.intent(item.id)?.revision === item.revision &&
			options.store.fileSelection(selection.id)?.revision === selection.revision
		);
	}

	private additionalMembers(selection: ManagedFileSelection) {
		return (selection.pending?.additionalRequestIds ?? []).flatMap((id) => {
			const item = this.context.options.store.intent(id);
			return item?.transferId === selection.id ? [item] : [];
		});
	}

	private authorizedMembers(
		item: DownloadIntent,
		selection: ManagedFileSelection,
	) {
		const additional = this.additionalMembers(selection);
		return (
			additional.length ===
				(selection.pending?.additionalRequestIds?.length ?? 0) &&
			[item, ...additional].every((member) => this.admission.current?.(member))
		);
	}

	private defer(execution: DownloadExecution) {
		execution.save({
			...execution.current,
			state: "unknown",
			error: "submission_unconfirmed",
			nextAttemptAt: this.context.now() + policy.activeIntervalMs,
		});
	}

	private finish(
		execution: DownloadExecution,
		selection: ManagedFileSelection,
		result: { remote: RemoteSelection } | { code: string; release?: boolean },
	) {
		const { options } = this.context;
		options.store.transaction(() => {
			if (!this.current(execution, selection)) return;
			const item = execution.current;
			const members = [
				execution,
				...this.additionalMembers(selection).map(
					(member) => new DownloadExecution(this.context, member),
				),
			];
			if ("remote" in result) {
				const observed = result.remote.observed;
				if (
					!observed ||
					!options.store.updateFileSelection({
						transferId: selection.id,
						revision: selection.revision,
						pending: null,
						observed,
						task: result.remote.task,
						observedAt: this.context.now(),
					})
				)
					return;
				for (const member of members)
					member.save({
						...member.current,
						state: "bound",
						error: null,
						observedAt: this.context.now(),
						nextAttemptAt: 0,
					});
			} else {
				const pending = selection.pending;
				const release =
					result.release ||
					(pending?.kind === "add" &&
						(pending.sentAt === null ||
							result.code === "external_task_conflict"));
				if (
					(pending || release) &&
					!options.store.updateFileSelection({
						transferId: selection.id,
						revision: selection.revision,
						pending: null,
						cancel: true,
						...(release ? { release: true } : {}),
					})
				)
					return;
				for (const member of members)
					member.save({
						...member.current,
						state: result.code === "externally_removed" ? "missing" : "blocked",
						error: result.code,
					});
			}
			options.logger.info(
				{
					event: "acquisition.file_selection_reconciled",
					intentId: item.id,
					transferId: selection.id,
					episodes: members.map(({ current }) => current.episode),
					reused: selection.pending?.kind === "expand",
					code: "code" in result ? result.code : null,
				},
				"Reconciled torrent file selection.",
			);
		});
	}
}
