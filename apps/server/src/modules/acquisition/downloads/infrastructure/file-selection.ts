import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { sameManifest } from "../domain/file-selection.js";
import type {
	DownloadIntent,
	EpisodeFilePlan,
	FileSelectionReservation,
	ManagedFileSelection,
	PendingFileSelection,
	PlannedDownloadFile,
} from "../domain/model.js";
import type { DownloadStore } from "../ports.js";
import { writeDownloadRequest } from "./records.js";
import {
	acquisitionEpisodeClaims as claims,
	acquisitionTransferFiles as files,
	acquisitionRequests as requests,
	acquisitionTransferFileTargets as targets,
	acquisitionTransfers as transfers,
} from "./schema.js";

export class FileSelectionRecords
	implements
		Pick<
			DownloadStore,
			| "fileSelection"
			| "ownedFileSelection"
			| "episodeFileSelection"
			| "planFileSelection"
			| "updateFileSelection"
		>
{
	constructor(private readonly store: Store) {}

	fileSelection(id: string) {
		return this.read(eq(transfers.id, id));
	}

	ownedFileSelection(hash: string, generation: string) {
		return this.read(
			and(
				eq(transfers.hash, hash),
				eq(transfers.destinationConnectionGeneration, generation),
				eq(transfers.owned, true),
			),
		);
	}

	episodeFileSelection(requestId: string, transferId: string) {
		const file = this.store
			.select({
				id: files.id,
				index: files.fileIndex,
				path: files.path,
				progress: files.progress,
			})
			.from(targets)
			.innerJoin(files, eq(files.id, targets.fileId))
			.innerJoin(transfers, eq(transfers.id, files.transferId))
			.where(
				and(
					eq(targets.claimId, requestId),
					eq(files.transferId, transferId),
					eq(files.role, "video"),
					eq(transfers.selectionMode, "files"),
				),
			)
			.get();
		if (file?.index == null) return null;
		const subtitles = this.store
			.select({
				index: files.fileIndex,
				path: files.path,
				progress: files.progress,
			})
			.from(files)
			.where(
				and(
					eq(files.transferId, transferId),
					eq(files.videoFileId, file.id),
					eq(files.desiredSelected, true),
				),
			)
			.all()
			.flatMap(({ index, path, progress }): PlannedDownloadFile[] =>
				index === null ? [] : [{ index, path, progress, role: "subtitle" }],
			)
			.sort((a, b) => a.index - b.index);
		const video: PlannedDownloadFile = {
			index: file.index,
			path: file.path,
			progress: file.progress,
			role: "video",
		};
		return {
			videoIndex: video.index,
			subtitleIndices: subtitles.map(({ index }) => index),
			files: [video, ...subtitles],
		};
	}

	planFileSelection(
		value: DownloadIntent,
		plan: EpisodeFilePlan,
		expectedRevision: string,
		additional: readonly FileSelectionReservation[] = [],
	): "planned" | "busy" | "incompatible" {
		const reservations = [
			{ item: value, plan, expectedRevision },
			...additional,
		];
		return this.store.transaction(
			(store) => {
				if (
					plan.manifest.indexSource !== "client" ||
					plan.manifest.files.some((file, index) => file.index !== index) ||
					!reservations.every((reservation) =>
						this.canReserve(store, reservation),
					) ||
					additional.some(
						({ item, plan: other }) =>
							item.workKey !== value.workKey ||
							item.destination.revision !== value.destination.revision ||
							item.directory !== value.directory ||
							(plan.manifest !== other.manifest &&
								!sameManifest(plan.manifest, other.manifest)),
					)
				)
					return "incompatible";
				const previous = store
					.select({ transfer: transfers, workKey: claims.workKey })
					.from(transfers)
					.innerJoin(claims, eq(claims.id, transfers.requestId))
					.where(
						and(
							eq(
								transfers.destinationConnectionGeneration,
								value.destination.connectionGeneration,
							),
							eq(transfers.hash, plan.manifest.hash),
							eq(transfers.owned, true),
						),
					)
					.get();
				const transfer = previous?.transfer;
				if (transfer) {
					if (
						!transfer.selectionManifest ||
						!sameManifest(transfer.selectionManifest, plan.manifest) ||
						previous?.workKey !== value.workKey ||
						transfer.destinationRevision !== value.destination.revision ||
						transfer.destinationScopeId !== value.destination.scopeId ||
						transfer.destinationPath !== value.destination.path ||
						transfer.directory !== value.directory
					)
						return "incompatible";
					if (transfer.pendingSelection) return "busy";
					if (!transfer.observedSelection) return "incompatible";
				}
				const keys = new Set(
					reservations.flatMap(({ plan }) => [
						plan.videoIndex,
						...plan.subtitleIndices,
					]),
				);
				const selected = new Set(
					transfer?.observedSelection
						?.filter((file) => file.selected)
						.map((file) => file.index),
				);
				const pending: PendingFileSelection = {
					requestId: value.id,
					...(additional.length
						? { additionalRequestIds: additional.map(({ item }) => item.id) }
						: {}),
					kind: transfer ? "expand" : "add",
					added: [...keys]
						.filter((index) => !selected.has(index))
						.sort((a, b) => a - b),
					sentAt: null,
				};
				writeDownloadRequest(
					store,
					{ ...value, hash: plan.manifest.hash },
					transfer ?? null,
				);
				const transferId = store
					.select({ id: claims.transferId })
					.from(claims)
					.where(eq(claims.id, value.id))
					.get()?.id;
				if (!transferId)
					throw new Error("Selective transfer reservation was not saved.");
				store
					.update(transfers)
					.set({
						selectionMode: "files",
						selectionRevision: randomUUID(),
						selectionManifest: plan.manifest,
						pendingSelection: pending,
					})
					.where(eq(transfers.id, transferId))
					.run();
				const saved = store
					.select()
					.from(transfers)
					.where(eq(transfers.id, transferId))
					.get();
				if (!saved) throw new Error("Selective transfer was not saved.");
				for (const { item, plan } of reservations) {
					if (item.id !== value.id)
						writeDownloadRequest(
							store,
							{ ...item, hash: plan.manifest.hash },
							saved,
						);
					const video = this.reserveFile(
						store,
						transferId,
						plan,
						plan.videoIndex,
						null,
					);
					store
						.insert(targets)
						.values({
							fileId: video,
							claimId: item.id,
							acceptedTarget: item.acceptedTarget,
						})
						.onConflictDoNothing()
						.run();
					for (const index of plan.subtitleIndices)
						this.reserveFile(store, transferId, plan, index, video);
				}
				return "planned";
			},
			{ behavior: "immediate" },
		);
	}

	updateFileSelection(
		input: Parameters<DownloadStore["updateFileSelection"]>[0],
	) {
		return this.store.transaction(
			(store) => {
				const row = store
					.select()
					.from(transfers)
					.where(
						and(
							eq(transfers.id, input.transferId),
							eq(transfers.selectionRevision, input.revision),
						),
					)
					.get();
				if (!row?.selectionManifest) return false;
				const changed =
					input.pending !== undefined ||
					input.observed !== undefined ||
					input.release;
				store
					.update(transfers)
					.set({
						...(changed ? { selectionRevision: randomUUID() } : {}),
						...(input.pending !== undefined
							? { pendingSelection: input.pending }
							: {}),
						...(input.observed ? { observedSelection: input.observed } : {}),
						...(input.observedAt !== undefined
							? { observedAt: input.observedAt }
							: {}),
						...(input.release ? { owned: false } : {}),
						...(input.task
							? {
									state: input.task.state,
									progress: input.task.progress,
								}
							: {}),
					})
					.where(eq(transfers.id, row.id))
					.run();
				for (const file of input.fileProgress ?? [])
					store
						.update(files)
						.set({ progress: file.progress })
						.where(
							and(
								eq(files.transferId, row.id),
								eq(files.fileIndex, file.index),
								or(isNull(files.progress), ne(files.progress, file.progress)),
							),
						)
						.run();
				if (input.cancel && row.pendingSelection) {
					const affected = store
						.select({ id: files.id })
						.from(files)
						.where(eq(files.transferId, row.id));
					store
						.delete(targets)
						.where(
							and(
								inArray(targets.claimId, [
									row.pendingSelection.requestId,
									...(row.pendingSelection.additionalRequestIds ?? []),
								]),
								inArray(targets.fileId, affected),
							),
						)
						.run();
					if (row.pendingSelection.added.length)
						store
							.update(files)
							.set({ desiredSelected: false })
							.where(
								and(
									eq(files.transferId, row.id),
									inArray(files.fileIndex, [...row.pendingSelection.added]),
								),
							)
							.run();
				}
				if (input.observed) {
					const observed = input.observed.flatMap((file) =>
						file.selected && file.index !== null ? [file.index] : [],
					);
					if (observed.length)
						store
							.update(files)
							.set({ observedSelected: true })
							.where(
								and(
									eq(files.transferId, row.id),
									inArray(files.fileIndex, observed),
								),
							)
							.run();
				}
				return true;
			},
			{ behavior: "immediate" },
		);
	}

	private canReserve(
		store: Store,
		{ item, plan, expectedRevision }: FileSelectionReservation,
	) {
		const request = store
			.select({
				revision: requests.revision,
				transferId: claims.transferId,
				live: claims.live,
			})
			.from(requests)
			.innerJoin(claims, eq(claims.requestId, requests.id))
			.where(eq(requests.id, item.id))
			.get();
		if (
			!request?.live ||
			request.revision !== expectedRevision ||
			request.transferId ||
			!item.acceptedTarget
		)
			return false;
		return !this.declinedFile(
			item.workKey,
			item.episode,
			plan.manifest.hash,
			plan.videoIndex,
			store,
		);
	}

	declinedFile(
		workKey: string,
		episode: number,
		hash: string,
		videoIndex: number,
		store = this.store,
	) {
		return Boolean(
			store
				.select({ id: claims.id })
				.from(claims)
				.innerJoin(targets, eq(targets.claimId, claims.id))
				.innerJoin(files, eq(files.id, targets.fileId))
				.innerJoin(transfers, eq(transfers.id, files.transferId))
				.where(
					and(
						eq(claims.workKey, workKey),
						eq(claims.episode, episode),
						eq(transfers.hash, hash),
						eq(files.fileIndex, videoIndex),
						eq(targets.declined, true),
					),
				)
				.get(),
		);
	}

	private read(where: SQL | undefined): ManagedFileSelection | null {
		const row = this.store
			.select({ transfer: transfers, workKey: claims.workKey })
			.from(transfers)
			.innerJoin(claims, eq(claims.id, transfers.requestId))
			.where(where)
			.get();
		const transfer = row?.transfer;
		if (!row || !transfer?.selectionManifest) return null;
		return {
			id: transfer.id,
			hash: transfer.hash,
			ownerKey: transfer.ownerKey,
			workKey: row.workKey,
			destination: {
				revision: transfer.destinationRevision,
				scopeId: transfer.destinationScopeId,
				path: transfer.destinationPath,
				connectionGeneration: transfer.destinationConnectionGeneration,
				validated: transfer.destinationValidated,
				visibilityVerified: transfer.destinationVisibilityVerified,
			},
			directory: transfer.directory,
			owned: transfer.owned,
			revision: transfer.selectionRevision,
			manifest: transfer.selectionManifest,
			pending: transfer.pendingSelection,
			observed: transfer.observedSelection,
		};
	}

	private reserveFile(
		store: Store,
		transferId: string,
		plan: EpisodeFilePlan,
		index: number,
		videoFileId: string | null,
	) {
		const file = plan.manifest.files[index];
		if (!file || file.index !== index)
			throw new Error("Missing stable index in selection plan.");
		const row = store
			.insert(files)
			.values({
				id: randomUUID(),
				transferId,
				fileIndex: index,
				path: file.path,
				sizeBytes: file.sizeBytes,
				role: videoFileId ? "subtitle" : "video",
				desiredSelected: true,
				videoFileId,
				ingestion: "not-ready",
			})
			.onConflictDoUpdate({
				target: [files.transferId, files.path],
				set: { desiredSelected: true },
			})
			.returning({ id: files.id })
			.get();
		if (!row) throw new Error("Selected file reservation was not saved.");
		return row.id;
	}
}
