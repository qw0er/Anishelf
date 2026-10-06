import type {
	MediaInfo,
	MediaProcessingOptions,
} from "../../platform/media/model.js";
import type { ServerMediaCapabilities } from "../../shared/media-capabilities.js";
import type { MediaProcessEvent } from "../../shared/media-execution.js";
import type { MediaExecutionSpecification } from "../../shared/media-processing.js";
/** An adapter must await child closure on cancellation. The production FFmpeg adapter is composed separately. */
export interface MediaExecutionAdapter {
	execute(
		input: string,
		output: string,
		options: MediaProcessingOptions,
		info: MediaInfo,
	): Promise<void>;
}

export interface MediaExecutionRequest extends MediaExecutionSpecification {
	/** A resource owner can narrow the output budget for this execution. */
	maximumBytes?: number;
	signal?: AbortSignal;
	onEvent?: (event: MediaExecutionEvent) => void;
}
export type MediaExecutionState =
	| "checking"
	| "starting"
	| "running"
	| "validating"
	| "ready"
	| "failed"
	| "cancelled";
export type MediaExecutionEvent =
	| MediaProcessEvent
	| { type: "state"; state: MediaExecutionState };
export interface MediaExecutionHandle {
	readonly id: string;
	readonly state: MediaExecutionState;
	readonly completion: Promise<ProcessedMedia>;
	/** Resolves after execution and cleanup finish. A completed result remains owned until release. */
	stop(): Promise<void>;
}

/** Backend-owned temporary output. release(id) removes it; this is not an HTTP DTO. */
export interface ProcessedMedia {
	id: string;
	fileId: string;
	sourceVersion: string;
	planId: string;
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
	output: { delivery: "file"; path: string };
	sizeBytes: number;
	info: MediaInfo;
}

export class MediaProcessingBusyError extends Error {
	constructor() {
		super("Media processing is busy.");
		this.name = "MediaProcessingBusyError";
	}
}

export interface MediaProcessingApi {
	start(request: MediaExecutionRequest): MediaExecutionHandle;
	release(id: string): Promise<void>;
	initialize(): Promise<void>;
}
export interface ProcessingTools {
	capabilities(): Promise<ServerMediaCapabilities>;
	probe(path: string, signal?: AbortSignal): Promise<MediaInfo>;
}
