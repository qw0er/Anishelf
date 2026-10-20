import type { MediaExecutionProgress } from "../../../../platform/media/events.js";
import type {
	PreparationFailureReason,
	PreparationState,
} from "../domain/model.js";
import type { PreparationSettingsSnapshot } from "../snapshot.js";
export interface PreparationRecord {
	id: string;
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
