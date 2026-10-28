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
export type * from "./snapshot.js";

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
