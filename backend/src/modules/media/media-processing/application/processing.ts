import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Logger } from "pino";
import type { MediaProcessEvent } from "../../../../platform/media/events.js";
import type { MediaStream } from "../../../../platform/media/index.js";
import {
	checkExecutionCapabilities,
	MediaExecutionCapabilityError,
	MediaOutputBudgetError,
	MediaToolError,
} from "../../../../platform/media/index.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import type { MediaInspectionApi } from "../../media-inspection/public.js";
import {
	describeAudio,
	describeVideo,
	expectedOutputSpec,
} from "../../media-planning/public.js";
import {
	validateExecutionRequest,
	validateProcessedMedia,
} from "../domain/validation.js";
import {
	MediaProcessingFiles,
	type ProcessingWorkspace,
} from "../infrastructure/files.js";
import {
	type MediaProcessingPolicy,
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "../policy.js";
import {
	type MediaExecutionAdapter,
	type MediaExecutionEvent,
	type MediaExecutionHandle,
	type MediaExecutionRequest,
	type MediaExecutionState,
	MediaProcessingBusyError,
	type ProcessedMedia,
	type ProcessingTools,
} from "../ports.js";
import type { MediaProcessingApi } from "../public.js";

function selectStream(
	streams: MediaStream[],
	type: "video" | "audio",
	index: number,
): MediaStream | undefined {
	const candidates = streams.filter(
		(stream) =>
			stream.type === type && (type !== "video" || !stream.attachedPicture),
	);
	if (!Number.isSafeInteger(index) || index < 0)
		throw new MediaToolError("INVALID_INPUT", "Invalid selected stream index.");
	const selected = candidates.find((stream) => stream.index === index);
	if (!selected)
		throw new MediaToolError(
			"INVALID_INPUT",
			"Selected stream is unavailable.",
		);
	return selected;
}

/** Explicit operations for future planners; no automatic conversion or compatibility claims. */
export class MediaProcessingApplication implements MediaProcessingApi {
	private readonly files: MediaProcessingFiles;
	private readonly policy: DeepReadonly<MediaProcessingPolicy>;
	private readonly controller = new AbortController();
	private readonly active = new Set<Promise<ProcessedMedia>>();
	private readonly outputs = new Map<
		string,
		{ workspace: ProcessingWorkspace; sizeBytes: number }
	>();
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			inspection: MediaInspectionApi;
			tools: ProcessingTools;
			executor: MediaExecutionAdapter;
			dataDir: string;
			policy?: DeepReadonly<MediaProcessingPolicy>;
			maximumProcessedBytes?: () => number;
			logger?: Logger;
		},
	) {
		const policy = options.policy ?? mediaProcessingPolicy;
		validateMediaProcessingPolicy(policy);
		this.policy = freeze(structuredClone(policy));
		this.files = new MediaProcessingFiles(options.dataDir);
	}
	start(request: MediaExecutionRequest): MediaExecutionHandle {
		return this.launch(validateExecutionRequest(request));
	}
	private launch(request: MediaExecutionRequest): MediaExecutionHandle {
		if (this.controller.signal.aborted)
			throw new MediaToolError(
				"TOOL_UNAVAILABLE",
				"Media processing is closed.",
			);
		if (this.active.size >= this.policy.concurrency)
			throw new MediaProcessingBusyError();
		const id = randomUUID();
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			this.controller.signal,
			...(request.signal ? [request.signal] : []),
		]);
		let state: MediaExecutionState = "checking";
		const emit = (event: MediaExecutionEvent) => {
			try {
				void Promise.resolve(request.onEvent?.(structuredClone(event))).catch(
					() =>
						this.options.logger?.warn(
							{ event: "media.processing_observer_failed" },
							"Processing observer failed.",
						),
				);
			} catch {
				this.options.logger?.warn(
					{ event: "media.processing_observer_failed" },
					"Processing observer failed.",
				);
			}
		};
		const transition = (next: MediaExecutionState) => {
			if (state === next && next !== "checking") return;
			state = next;
			emit({ type: "state", state });
		};
		// Deferral registers the job before observers can submit another operation.
		const active = Promise.resolve()
			.then(() => {
				transition("checking");
				return this.run(
					{ ...request, signal },
					id,
					(event) => {
						if (event.type === "started") transition("starting");
						if (event.type === "progress") transition("running");
						if (event.type === "closed" && !event.reason)
							transition("validating");
						emit(event);
					},
					() => transition("validating"),
				);
			})
			.then(
				(result) => {
					transition("ready");
					return result;
				},
				(error: unknown) => {
					transition(signal.aborted ? "cancelled" : "failed");
					throw error;
				},
			);
		this.active.add(active);
		void active.finally(() => this.active.delete(active)).catch(() => {});
		return {
			id,
			get state() {
				return state;
			},
			completion: active,
			async stop() {
				controller.abort();
				await active.catch(() => {});
			},
		};
	}
	private async run(
		request: MediaExecutionRequest,
		id: string,
		onEvent: (event: MediaProcessEvent) => void,
		onValidating: () => void,
	): Promise<ProcessedMedia> {
		const signal = request.signal
			? AbortSignal.any([request.signal, this.controller.signal])
			: this.controller.signal;
		signal.throwIfAborted();
		const plan = request.plan;
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
		const selectedAudios = request.audioStreamIndices.map((index) => {
			const stream = selectStream(info.streams, "audio", index);
			if (!stream)
				throw new MediaToolError(
					"INVALID_INPUT",
					"Selected audio stream is unavailable.",
				);
			return stream;
		});
		if (!video)
			throw new MediaToolError(
				"INVALID_INPUT",
				"No usable video stream is available for processing.",
			);
		const expected = expectedOutputSpec(
			describeVideo(video),
			selectedAudios.map(describeAudio),
			plan,
		);
		const check = checkExecutionCapabilities(
			await this.options.tools.capabilities(),
			plan,
			info,
			video.index,
			selectedAudios.map((audio) => audio.index),
		);
		if (check.status !== "supported")
			throw new MediaExecutionCapabilityError(check);
		signal.throwIfAborted();
		const retainedBytes = [...this.outputs.values()].reduce(
			(total, output) => total + output.sizeBytes,
			0,
		);
		const budget =
			this.options.maximumProcessedBytes?.() ??
			this.policy.maximumProcessedBytes;
		const maximumBytes = Math.min(
			budget - retainedBytes,
			request.maximumBytes ?? budget,
		);
		if (maximumBytes <= 0)
			throw new MediaToolError(
				"TOOL_FAILED",
				"Release existing processed media before generating more output.",
			);
		await this.options.sources.revalidateSource(source);
		signal.throwIfAborted();
		const workspace = await this.files.allocate();
		try {
			await this.options.executor.execute(
				await this.options.sources.filePath(source),
				workspace.pendingPath,
				{
					plan,
					onEvent,
					videoStreamIndex: video.index,
					audioStreamIndices: selectedAudios.map((audio) => audio.index),
					maximumBytes,
					timeoutMs: this.policy.processingTimeoutMs,
					signal,
				},
				info,
			);
			signal.throwIfAborted();
			onValidating();
			const size = (await stat(workspace.pendingPath)).size;
			if (size >= maximumBytes) throw new MediaOutputBudgetError();
			if (size <= 0)
				throw new MediaToolError(
					"TOOL_FAILED",
					"Processed media is empty or exceeds its size limit.",
				);
			const output = await this.options.tools.probe(
				workspace.pendingPath,
				signal,
			);
			validateProcessedMedia(
				output,
				info,
				video,
				selectedAudios,
				plan,
				expected,
				this.policy.durationToleranceSeconds,
			);
			await this.options.sources.revalidateSource(source);
			signal.throwIfAborted();
			const sizeBytes = await this.files.publish(workspace);
			await this.options.sources.revalidateSource(source);
			signal.throwIfAborted();
			this.outputs.set(id, { workspace, sizeBytes });
			return {
				id,
				fileId: source.identity.fileId,
				sourceVersion: source.identity.sourceVersion,
				planId: plan.id,
				videoStreamIndex: video.index,
				audioStreamIndices: selectedAudios.map((audio) => audio.index),
				output: { delivery: "file", path: workspace.path },
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
	/** Startup only: previous process workspaces are never reusable completed copies. */
	async initialize(): Promise<void> {
		if (this.active.size || this.outputs.size)
			throw new Error("Processing has already started.");
		await this.files.initialize();
	}
	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.active);
		await Promise.all([...this.outputs.keys()].map((id) => this.release(id)));
	}
}
