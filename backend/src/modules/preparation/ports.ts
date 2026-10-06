import type { CompatibilityCheckRequest } from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { MediaPlanningResult } from "../media-planning/public.js";

/** Preparation only requires a read-only, source-bound planning decision. */
export interface PreparationPlanner {
	plan(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<MediaPlanningResult>>;
}

import type { PreparationTask, PreparedArtifact } from "./domain/model.js";
/** Synchronous commits keep deduplication and queue admission atomic within the backend process. */
export interface PreparationStore {
	list(limit?: number, fileId?: string): PreparationTask[];
	get(id: string): PreparationTask | undefined;
	find(planId: string): PreparationTask | undefined;
	queuedCount(): number;
	nextQueued(): PreparationTask | undefined;
	artifactBytes(): number;
	insert(task: PreparationTask): void;
	save(task: PreparationTask): void;
	publish(task: PreparationTask, artifact: PreparedArtifact): void;
	artifact(id: string): PreparedArtifact | undefined;
	artifacts(): PreparedArtifact[];
	removeArtifact(task: PreparationTask): void;
}
