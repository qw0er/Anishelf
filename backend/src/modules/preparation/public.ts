export type {
	PreparationFailureReason,
	PreparationTask,
	PreparationTaskDto,
	PreparedArtifact,
	PreparedHlsArtifact,
	PreparedResource,
} from "./domain/model.js";

import type { FileHandle } from "node:fs/promises";
import type {
	CompatibilityCheckRequest,
	PreparationStartResponse,
} from "../../contracts/http.js";
import type { PreparationTaskDto } from "./domain/model.js";
export interface PreparationApi {
	create(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<PreparationStartResponse>;
	get(id: string): Promise<PreparationTaskDto>;
	list(fileId?: string): Promise<{ tasks: PreparationTaskDto[] }>;
	cancel(id: string): Promise<PreparationTaskDto>;
	retry(
		id: string,
		input: CompatibilityCheckRequest,
	): Promise<PreparationTaskDto>;
	deleteArtifact(id: string): Promise<void>;
	openArtifact(id: string): Promise<{
		handle: FileHandle;
		sizeBytes: number;
		mimeType: string;
		release(): Promise<void>;
	}>;
}
