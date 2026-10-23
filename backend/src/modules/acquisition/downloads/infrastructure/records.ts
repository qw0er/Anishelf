import type { Store } from "../../../../platform/database/store.js";
import type { DownloadDestination, DownloadIntent } from "../domain/model.js";
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

export function readAcquisitionIntents(
	_store: Store,
	row: typeof s.acquisitionIntents.$inferSelect,
): DownloadIntent {
	return {
		id: row.id,
		revision: row.revision,
		workKey: row.workKey,
		candidateId: row.candidateId,
		episode: row.episode,
		title: row.title,
		hash: row.hash,
		expectedHash: row.expectedHash,
		source: row.source,
		destination: {
			revision: row.destinationRevision,
			scopeId: row.destinationScopeId,
			path: row.destinationPath,
			connectionGeneration: row.destinationConnectionGeneration,
			validated: row.destinationValidated,
			visibilityVerified: row.destinationVisibilityVerified,
		},
		directory: row.directory,
		subscriptionRevision: row.subscriptionRevision,
		state: row.state,
		transfer: row.transfer,
		progress: row.progress,
		ingestion: row.ingestion,
		error: row.error,
		attempts: row.attempts,
		nextAttemptAt: row.nextAttemptAt,
		observedAt: row.observedAt,
		updatedAt: row.updatedAt,
		createdAt: row.createdAt,
		sourceIdentity: row.sourceIdentityPresent
			? {
					scopeId: row.sourceIdentityScopeId,
					fileId: row.sourceIdentityFileId,
					relativePath: row.sourceIdentityRelativePath,
					sourceVersion: row.sourceIdentitySourceVersion,
				}
			: null,
		lastCommand: row.lastCommandPresent
			? { id: row.lastCommandId, kind: row.lastCommandKind }
			: null,
	} as DownloadIntent;
}

export function writeAcquisitionIntents(
	connection: Store,
	value: DownloadIntent,
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			revision: value?.revision,
			workKey: value?.workKey,
			candidateId: value?.candidateId,
			episode: value?.episode,
			title: value?.title,
			hash: value?.hash,
			expectedHash: value?.expectedHash ?? null,
			source: value?.source,
			destinationRevision: value?.destination?.revision,
			destinationScopeId: value?.destination?.scopeId,
			destinationPath: value?.destination?.path,
			destinationConnectionGeneration: value?.destination?.connectionGeneration,
			destinationValidated: value?.destination?.validated,
			destinationVisibilityVerified: value?.destination?.visibilityVerified,
			directory: value?.directory,
			subscriptionRevision: value?.subscriptionRevision,
			state: value?.state,
			transfer: value?.transfer ?? null,
			progress: value?.progress ?? null,
			ingestion: value?.ingestion,
			error: value?.error ?? null,
			attempts: value?.attempts,
			nextAttemptAt: value?.nextAttemptAt,
			observedAt: value?.observedAt ?? null,
			updatedAt: value?.updatedAt,
			createdAt: value?.createdAt,
			sourceIdentityPresent:
				value?.sourceIdentity !== null && value?.sourceIdentity !== undefined,
			sourceIdentityScopeId: value?.sourceIdentity?.scopeId ?? null,
			sourceIdentityFileId: value?.sourceIdentity?.fileId ?? null,
			sourceIdentityRelativePath: value?.sourceIdentity?.relativePath ?? null,
			sourceIdentitySourceVersion: value?.sourceIdentity?.sourceVersion ?? null,
			lastCommandPresent:
				value?.lastCommand !== null && value?.lastCommand !== undefined,
			lastCommandId: value?.lastCommand?.id ?? null,
			lastCommandKind: value?.lastCommand?.kind ?? null,
		};
		store
			.insert(s.acquisitionIntents)
			.values(row0)
			.onConflictDoUpdate({ target: s.acquisitionIntents.id, set: row0 })
			.run();
	});
}
