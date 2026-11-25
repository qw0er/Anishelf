import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import {
	type DownloadDestination,
	DownloadError,
	type DownloadIntent,
	isCanonicalDownloadHash,
	keepsEpisodeClaim,
	type VerifiedDownloadFiles,
} from "../domain/model.js";
import * as s from "./schema.js";

export function readAcquisitionDestination(
	_store: Store,
	row: typeof s.acquisitionDestination.$inferSelect,
): DownloadDestination & { id: string } {
	return {
		id: row.id,
		revision: row.revision,
		scopeId: row.scopeId,
		path: row.path,
		connectionGeneration: row.connectionGeneration,
		validated: row.validated,
		visibilityVerified: row.visibilityVerified,
	} as DownloadDestination & { id: string };
}

export function writeAcquisitionDestination(
	connection: Store,
	value: DownloadDestination & { id: string },
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			revision: value?.revision,
			scopeId: value?.scopeId,
			path: value?.path,
			connectionGeneration: value?.connectionGeneration,
			validated: value?.validated,
			visibilityVerified: value?.visibilityVerified,
		};
		store
			.insert(s.acquisitionDestination)
			.values(row0)
			.onConflictDoUpdate({ target: s.acquisitionDestination.id, set: row0 })
			.run();
	});
}

type TransferRow = typeof s.acquisitionTransfers.$inferSelect;
type ClaimRow = typeof s.acquisitionEpisodeClaims.$inferSelect;

export function readDownloadRequest({
	request,
	claim,
	transfer,
}: {
	request: typeof s.acquisitionRequests.$inferSelect;
	claim: ClaimRow;
	transfer: TransferRow | null;
}): DownloadIntent {
	return {
		id: request.id,
		revision: request.revision,
		workKey: claim.workKey,
		episode: claim.episode,
		acceptedTarget: claim.acceptedTarget,
		candidateId: request.candidateId,
		title: request.title,
		hash:
			transfer?.hash ?? request.unresolvedHash ?? `unresolved:${request.id}`,
		...(transfer
			? { transferId: transfer.id, ownerKey: transfer.ownerKey }
			: {}),
		expectedHash: request.expectedHash,
		source: request.source,
		destination: {
			revision: request.destinationRevision,
			scopeId: request.destinationScopeId,
			path: request.destinationPath,
			connectionGeneration: request.destinationConnectionGeneration,
			validated: request.destinationValidated,
			visibilityVerified: request.destinationVisibilityVerified,
		},
		directory: request.directory,
		origin: request.origin,
		oneOff: request.oneOff,
		subscriptionRevision: request.subscriptionRevision,
		state: request.state,
		transfer:
			request.source || request.title ? (transfer?.state ?? null) : null,
		progress: transfer?.progress ?? null,
		ingestion: claim.ingestion,
		error: request.error,
		attempts: request.attempts,
		nextAttemptAt: request.nextAttemptAt,
		observedAt: transfer?.observedAt ?? null,
		createdAt: request.createdAt,
		updatedAt: request.updatedAt,
		sourceIdentity: claim.sourceIdentity,
		lastCommand:
			request.lastCommandId && request.lastCommandKind
				? { id: request.lastCommandId, kind: request.lastCommandKind }
				: null,
	};
}

function destinationFields(value: DownloadIntent) {
	return {
		destinationRevision: value.destination.revision,
		destinationScopeId: value.destination.scopeId,
		destinationPath: value.destination.path,
		destinationConnectionGeneration: value.destination.connectionGeneration,
		destinationValidated: value.destination.validated,
		destinationVisibilityVerified: value.destination.visibilityVerified,
		directory: value.directory,
	};
}

export function writeDownloadRequest(
	store: Store,
	value: DownloadIntent,
	previous: TransferRow | null,
	files?: VerifiedDownloadFiles,
) {
	const canonical = isCanonicalDownloadHash(value.hash);
	const request = {
		id: value.id,
		revision: value.revision,
		candidateId: value.candidateId,
		title: value.title,
		unresolvedHash: canonical ? null : value.hash,
		expectedHash: value.expectedHash,
		source: value.source,
		...destinationFields(value),
		origin: value.origin,
		oneOff: value.oneOff,
		subscriptionRevision: value.subscriptionRevision,
		state: value.state,
		error: value.error,
		attempts: value.attempts,
		nextAttemptAt: value.nextAttemptAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastCommandId: value.lastCommand?.id ?? null,
		lastCommandKind: value.lastCommand?.kind ?? null,
	};
	store
		.insert(s.acquisitionRequests)
		.values(request)
		.onConflictDoUpdate({ target: s.acquisitionRequests.id, set: request })
		.run();
	const transferId = canonical
		? saveTransfer(store, value, previous, files)
		: null;
	const claim = {
		id: value.id,
		requestId: value.id,
		workKey: value.workKey,
		episode: value.episode,
		acceptedTarget: value.acceptedTarget ?? null,
		transferId,
		live: keepsEpisodeClaim(value),
		ingestion: value.ingestion,
		sourceIdentity: value.sourceIdentity,
	};
	store
		.insert(s.acquisitionEpisodeClaims)
		.values(claim)
		.onConflictDoUpdate({ target: s.acquisitionEpisodeClaims.id, set: claim })
		.run();
	if (transferId && value.sourceIdentity)
		saveFileEvidence(store, claim, transferId, value.sourceIdentity, files);
}

function saveTransfer(
	store: Store,
	value: DownloadIntent,
	previous: TransferRow | null,
	files?: VerifiedDownloadFiles,
) {
	const continued =
		previous?.hash === value.hash &&
		previous.destinationConnectionGeneration ===
			value.destination.connectionGeneration;
	const observation = {
		owned: keepsEpisodeClaim(value) || value.state === "available",
		state: value.transfer,
		progress: value.progress,
		observedAt: value.observedAt,
		...(files ? { observedSelection: files.selection } : {}),
	};
	if (continued && previous) {
		store
			.update(s.acquisitionTransfers)
			.set(observation)
			.where(eq(s.acquisitionTransfers.id, previous.id))
			.run();
		return previous.id;
	}
	const id = randomUUID();
	store
		.insert(s.acquisitionTransfers)
		.values({
			id,
			requestId: value.id,
			ownerKey: previous?.ownerKey ?? value.id,
			hash: value.hash,
			source: value.source,
			...destinationFields(value),
			selectionRevision: value.revision,
			...observation,
		})
		.run();
	return id;
}

function saveFileEvidence(
	store: Store,
	claim: Pick<ClaimRow, "id" | "acceptedTarget" | "ingestion">,
	transferId: string,
	sourceIdentity: NonNullable<DownloadIntent["sourceIdentity"]>,
	files?: VerifiedDownloadFiles,
) {
	const associated = s.acquisitionTransferFileTargets;
	const transferFiles = s.acquisitionTransferFiles;
	if (!files) {
		const known = store
			.select({ id: transferFiles.id })
			.from(associated)
			.innerJoin(transferFiles, eq(associated.fileId, transferFiles.id))
			.where(
				and(
					eq(transferFiles.transferId, transferId),
					eq(associated.claimId, claim.id),
				),
			)
			.get();
		if (known)
			store
				.update(transferFiles)
				.set({ ingestion: claim.ingestion })
				.where(eq(transferFiles.id, known.id))
				.run();
		return;
	}
	const file = files.video;
	const prior = store
		.select({ index: transferFiles.fileIndex, size: transferFiles.sizeBytes })
		.from(transferFiles)
		.where(
			and(
				eq(transferFiles.transferId, transferId),
				eq(transferFiles.path, file.path),
			),
		)
		.get();
	if (
		(prior?.index != null &&
			file.index !== null &&
			prior.index !== file.index) ||
		(prior?.size != null && prior.size !== file.sizeBytes)
	)
		throw new DownloadError("download_changed");
	const verified = {
		fileIndex: file.index ?? prior?.index ?? null,
		path: file.path,
		sizeBytes: file.sizeBytes,
		desiredSelected: true,
		observedSelected: true,
		ingestion: claim.ingestion,
		sourceIdentity,
	};
	const stored = store
		.insert(transferFiles)
		.values({
			id: randomUUID(),
			transferId,
			role: "video",
			...verified,
		})
		.onConflictDoUpdate({
			target: [transferFiles.transferId, transferFiles.path],
			set: verified,
		})
		.returning({ id: transferFiles.id })
		.get();
	if (!stored) throw new Error("Verified transfer file was not saved.");
	store
		.insert(associated)
		.values({
			fileId: stored.id,
			claimId: claim.id,
			acceptedTarget: claim.acceptedTarget,
		})
		.onConflictDoUpdate({
			target: [associated.fileId, associated.claimId],
			set: { acceptedTarget: claim.acceptedTarget },
		})
		.run();
}
