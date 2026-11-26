import type { MediaExecutionProgress } from "@anishelf/media-tools";
import type {
	PreparationFailureReason,
	PreparationState,
} from "../domain/model.js";
import type {
	PreparationDemand,
	PreparationSettingsSnapshot,
} from "../snapshot.js";
export interface PreparationRecord {
	id: string;
	demand?: PreparationDemand;
	sourceId: string;
	executionPlanId: string;
	profileId: string;
	profileFingerprint: string;
	filename: string;
	snapshot: PreparationSettingsSnapshot;
	status: PreparationState["status"];
	progress: MediaExecutionProgress | null;
	failureReason: PreparationFailureReason | null;
	createdAtMs: number;
	updatedAtMs: number;
}
