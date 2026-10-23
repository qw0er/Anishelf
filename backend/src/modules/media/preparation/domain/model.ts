import type { MediaExecutionProgress } from "../../../../platform/media/events.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { SourceIdentity } from "../../../resources/public.js";
import type { PreparationSettingsSnapshot } from "../snapshot.js";
export type PreparationFailureReason =
	| "interrupted"
	| "cancelled"
	| "cache-deleted"
	| "cache-missing"
	| "cache-full"
	| "storage-full"
	| "source-changed"
	| "profile-changed"
	| "tool-unavailable"
	| "capability-missing"
	| "capability-unknown"
	| "processing-failed";
interface PreparationSpecification {
	source: SourceIdentity;
	executionPlanId: string;
	profileFingerprint: string;
	settings: PreparationSettingsSnapshot;
}
export type PreparationState = { updatedAtMs: number } & (
	| { status: "queued"; progress: null; failureReason: null }
	| {
			status: "processing" | "cancelling" | "ready";
			progress: MediaExecutionProgress | null;
			failureReason: null;
	  }
	| {
			status: "failed";
			progress: MediaExecutionProgress | null;
			failureReason: PreparationFailureReason;
	  }
	| {
			status: "cancelled";
			progress: MediaExecutionProgress | null;
			failureReason: "cancelled" | "cache-deleted";
	  }
);
export interface PreparationTask {
	readonly id: string;
	readonly spec: DeepReadonly<PreparationSpecification>;
	readonly filename: string;
	profileId: string;
	state: PreparationState;
	readonly createdAtMs: number;
}
export interface PreparationView {
	task: PreparationTask;
	artifact: PreparedArtifact | null;
	availability: "ready" | "unknown" | "unavailable";
}
export type PreparationCreation =
	| { kind: "direct"; fileId: string; mimeType: string }
	| { kind: "blocked"; reason: string }
	| { kind: "task"; view: PreparationView };
export interface PreparedArtifact {
	delivery: "file";
	id: string;
	taskId: string;
	sizeBytes: number;
	mimeType: string;
}
