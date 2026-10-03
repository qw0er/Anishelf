import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Logger } from "pino";
import type {
	MediaInfo,
	MediaProcessingMode,
	MediaStream,
	MediaTools,
} from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../configuration/public.js";
import type { MediaInspectionApi } from "../../media-inspection/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import {
	MediaProcessingFiles,
	type ProcessingWorkspace,
} from "../infrastructure/files.js";

export interface MediaProcessingRequest {
	fileId: string;
	sourceVersion: string;
	mode: MediaProcessingMode;
	/** Backend-only absolute FFprobe indexes; omission selects default/first usable. */
	videoStreamIndex?: number;
	audioStreamIndex?: number | null;
	signal?: AbortSignal;
}

/** Backend-owned temporary output. release(id) removes it; this is not an HTTP DTO. */
export interface ProcessedMedia {
	id: string;
	fileId: string;
	sourceVersion: string;
	mode: MediaProcessingMode;
	profileId: "mp4-h264-aac-v1";
	videoStreamIndex: number;
	audioStreamIndex: number | null;
	path: string;
	sizeBytes: number;
	info: MediaInfo;
}

export class MediaProcessingBusyError extends Error {
	constructor() {
		super("Media processing is busy.");
		this.name = "MediaProcessingBusyError";
	}
}

function selectStream(
	streams: MediaStream[],
	type: "video" | "audio",
	index?: number,
): MediaStream | undefined {
	const candidates = streams.filter(
		(stream) =>
			stream.type === type && (type !== "video" || !stream.attachedPicture),
	);
	if (index !== undefined) {
		if (!Number.isSafeInteger(index) || index < 0)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Invalid selected stream index.",
			);
		const selected = candidates.find((stream) => stream.index === index);
		if (!selected)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Selected stream is unavailable.",
			);
		return selected;
	}
	return candidates.find((stream) => stream.default) ?? candidates[0];
}

/** Explicit operations for future planners; no automatic conversion or compatibility claims. */
export class MediaProcessingApplication {
	private readonly files: MediaProcessingFiles;
	private readonly policy: DeepReadonly<BuiltinPolicy>["media"];
	private readonly controller = new AbortController();
	private active: Promise<ProcessedMedia> | undefined;
	private readonly outputs = new Map<
		string,
		{ workspace: ProcessingWorkspace; sizeBytes: number }
	>();
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			inspection: MediaInspectionApi;
			tools: Pick<MediaTools, "processMedia">;
			dataDir: string;
			policy?: DeepReadonly<BuiltinPolicy>["media"];
			logger?: Logger;
		},
	) {
		this.policy = options.policy ?? builtinPolicy.media;
		this.files = new MediaProcessingFiles(options.dataDir);
	}
	process(request: MediaProcessingRequest): Promise<ProcessedMedia> {
		if (this.controller.signal.aborted)
			return Promise.reject(
				new MediaToolError("TOOL_UNAVAILABLE", "Media processing is closed."),
			);
		if (this.active) return Promise.reject(new MediaProcessingBusyError());
		// Own the request values for the duration of asynchronous work.
		const active = this.run({ ...request });
		this.active = active;
		void active
			.finally(() => {
				if (this.active === active) this.active = undefined;
			})
			.catch(() => {});
		return active;
	}
	private async run(request: MediaProcessingRequest): Promise<ProcessedMedia> {
		const signal = request.signal
			? AbortSignal.any([request.signal, this.controller.signal])
			: this.controller.signal;
		signal.throwIfAborted();
		if (typeof request.sourceVersion !== "string" || !request.sourceVersion)
			throw new MediaToolError(
				"INVALID_INPUT",
				"A source version is required for media processing.",
			);
		const { source, info } = await this.options.inspection.inspect(
			request.fileId,
			request.sourceVersion,
		);
		signal.throwIfAborted();
		const video = selectStream(info.streams, "video", request.videoStreamIndex);
		const audio =
			request.audioStreamIndex === null
				? undefined
				: selectStream(info.streams, "audio", request.audioStreamIndex);
		if (!video)
			throw new MediaToolError(
				"INVALID_INPUT",
				"No usable video stream is available for processing.",
			);
		const retainedBytes = [...this.outputs.values()].reduce(
			(total, output) => total + output.sizeBytes,
			0,
		);
		const maximumBytes = this.policy.maximumProcessedBytes - retainedBytes;
		if (maximumBytes <= 0)
			throw new MediaToolError(
				"TOOL_FAILED",
				"Release existing processed media before generating more output.",
			);
		await this.options.sources.revalidateSource(source);
		signal.throwIfAborted();
		const workspace = await this.files.allocate();
		try {
			const output = await this.options.tools.processMedia(
				join(source.identity.canonicalRoot, source.identity.relativePath),
				workspace.pendingPath,
				{
					mode: request.mode,
					videoStreamIndex: video.index,
					audioStreamIndex: audio?.index ?? null,
					maximumBytes,
					signal,
				},
				info,
			);
			await this.options.sources.revalidateSource(source);
			signal.throwIfAborted();
			const sizeBytes = await this.files.publish(workspace);
			await this.options.sources.revalidateSource(source);
			signal.throwIfAborted();
			const id = randomUUID();
			this.outputs.set(id, { workspace, sizeBytes });
			return {
				id,
				fileId: source.identity.fileId,
				sourceVersion: source.identity.sourceVersion,
				mode: request.mode,
				profileId: "mp4-h264-aac-v1",
				videoStreamIndex: video.index,
				audioStreamIndex: audio?.index ?? null,
				path: workspace.path,
				sizeBytes,
				info: output,
			};
		} catch (cause) {
			await this.files.remove(workspace).catch(() => {
				this.options.logger?.warn(
					{ event: "media.processing_cleanup_failed" },
					"Failed to remove private processing output.",
				);
			});
			// File/root conflicts take precedence over a secondary FFmpeg failure.
			await this.options.sources.revalidateSource(source);
			throw cause;
		}
	}
	async release(id: string): Promise<void> {
		const output = this.outputs.get(id);
		if (!output) return;
		await this.files.remove(output.workspace);
		this.outputs.delete(id);
	}
	async close(): Promise<void> {
		this.controller.abort();
		if (this.active) await Promise.allSettled([this.active]);
		await Promise.all([...this.outputs.keys()].map((id) => this.release(id)));
	}
}
