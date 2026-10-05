import type { Static } from "typebox";
import type {
	PreparationTaskSchema,
	preparationFailureReasons,
	preparationStatuses,
} from "../../../contracts/schemas/preparation.js";
import type { MediaExecutionProgress } from "../../../shared/media-execution.js";
import type { MediaPreparationSnapshot } from "../../../shared/media-preparation.js";
import type { SourceIdentity } from "../../resource-access/public.js";

export type PreparationTaskDto = Static<typeof PreparationTaskSchema>;
export type PreparationStatus = (typeof preparationStatuses)[number];
export type PreparationFailureReason =
	(typeof preparationFailureReasons)[number];
export interface PreparationTask extends MediaPreparationSnapshot {
	id: string;
	source: SourceIdentity;
	filename: string;
	profileId: string;
	status: PreparationStatus;
	progress: MediaExecutionProgress | null;
	failureReason: PreparationFailureReason | null;
	createdAtMs: number;
	updatedAtMs: number;
}
export interface PreparedArtifact {
	delivery: "file";
	id: string;
	taskId: string;
	sizeBytes: number;
	mimeType: string;
}

/** Completed HLS artifacts are owned by preparation; runtime sessions cannot delete them. */
export interface PreparedHlsArtifact {
	id: string;
	taskId: string;
	resourceId: string;
	delivery: "hls";
	completeness: "complete";
	sizeBytes: number;
	mimeType: "application/vnd.apple.mpegurl";
}
export type PreparedResource = PreparedArtifact | PreparedHlsArtifact;
