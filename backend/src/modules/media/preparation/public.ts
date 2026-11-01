import type { PreparationDemand } from "./snapshot.js";

export type { PreparationCreation } from "./domain/model.js";

import type { FileHandle } from "node:fs/promises";
import type { CompatibilityCheckRequest } from "../../../contracts/http.js";
import type { PreparationCreation, PreparationView } from "./domain/model.js";
export interface PreparationApi {
	catalog(fileId: string): Promise<PreparedMediaInventory>;
	create(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<PreparationCreation>;
	get(id: string): Promise<PreparationView>;
	list(fileId?: string): Promise<{ tasks: PreparationView[] }>;
	cancel(id: string): Promise<PreparationView>;
	retry(id: string, input: CompatibilityCheckRequest): Promise<PreparationView>;
	deleteArtifact(id: string): Promise<void>;
	openArtifact(id: string): Promise<{
		handle: FileHandle;
		sizeBytes: number;
		mimeType: string;
		release(): Promise<void>;
	}>;
}

export interface PreparedMediaInventory {
	assets: {
		id: string;
		source: import("../../resources/public.js").SourceIdentity;
		profileId: string;
		sourceAudioStreamIndices: number[];
		sizeBytes: number;
		mimeType: string;
		info: import("../../../platform/media/model.js").MediaInfo;
		updatedAtMs: number;
	}[];
	pending: {
		source: import("../../resources/public.js").SourceIdentity;
		sourceAudioStreamIndices: number[];
	}[];
}

export type { PreparationTask, PreparationView } from "./domain/model.js";
export type { PreparationStore } from "./ports.js";
export interface PreparationAutomationApi
	extends Pick<PreparationApi, "catalog" | "get"> {
	setAutomaticGuard(
		guard: (
			task: import("./domain/model.js").PreparationTask,
		) => Promise<boolean>,
	): void;
	automaticRetry?: (
		id: string,
	) => Promise<import("./domain/model.js").PreparationView>;
	reconcileAutomatic(
		predicate: (task: import("./domain/model.js").PreparationTask) => boolean,
	): Promise<void>;
	createAutomatic(
		fileId: string,
		sourceVersion: string,
		profileId: string,
		planned: import("../../../shared/policy.js").DeepReadonly<
			Extract<
				import("../media-planning/public.js").MediaPlanningResult,
				{ kind: "processing-required" }
			>
		>,
		demand: PreparationDemand,
	): Promise<import("./domain/model.js").PreparationView>;
}
