import type { FileHandle } from "node:fs/promises";
import type { Logger } from "pino";
import type { PreparedMediaItem } from "../../../contracts/http.js";
import type { MediaExecutionProgress } from "../../../platform/media/events.js";
import type { MediaInfo } from "../../../platform/media/model.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
} from "../../resources/public.js";
import type { ProcessedMedia } from "../preparation/execution/public.js";
import type {
	PreparationFailureReason,
	PreparationStore,
	PreparationTask,
	PreparationView,
	PreparedArtifact,
} from "../preparation/public.js";
export class InvalidPreparedMediaError extends Error {
	constructor() {
		super("Prepared media is not a valid completed file.");
	}
}
export interface PreparedMediaFiles {
	path(id: string): string;
	initialize(artifacts: PreparedArtifact[]): Promise<Set<string>>;
	availableBytes(): Promise<number>;
	publish(id: string, processedPath: string, sizeBytes: number): Promise<void>;
	open(artifact: PreparedArtifact): Promise<FileHandle>;
	inspect(
		artifact: PreparedArtifact,
		probe: (path: string) => Promise<MediaInfo>,
	): Promise<MediaInfo>;
	remove(id: string): Promise<void>;
}
export interface ArtifactContext {
	readonly repository: PreparationStore;
	readonly sources: ResourceAccessApi;
	readonly files: PreparedMediaFiles;
	readonly logger: Logger;
	readonly closed: boolean;
	probe(path: string): Promise<MediaInfo>;
	assertOpen(): void;
	required(id: string): PreparationTask;
	source(task: PreparationTask): Promise<ResolvedSource>;
	failure(error: unknown): PreparationFailureReason;
}
export interface PreparationArtifacts {
	assertUnborrowed(id: string): void;
	retainedBytes(): number;
	invalidate(
		task: PreparationTask,
		reason: PreparationFailureReason,
	): Promise<void>;
	cleanupMissingSources(): Promise<void>;
	inspect(id: string): Promise<PreparationView>;
	open(id: string): Promise<{
		path: string;
		handle: FileHandle;
		sizeBytes: number;
		mimeType: string;
		release(): Promise<void>;
	}>;
	managementState(
		artifact: PreparedArtifact,
	): Promise<Pick<PreparedMediaItem, "status" | "deleteBlockedReason"> | null>;
	delete(id: string): Promise<void>;
	publish(
		task: PreparationTask,
		processed: ProcessedMedia,
		minimumFreeBytes: number,
		progress: MediaExecutionProgress | null,
		signal: AbortSignal,
	): Promise<void>;
	finishFailure(
		id: string,
		reason: PreparationFailureReason,
		progress: MediaExecutionProgress | null,
	): Promise<void>;
}
