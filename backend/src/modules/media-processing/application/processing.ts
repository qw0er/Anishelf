import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type {
	MediaInfo,
	MediaProcessingOptions,
	MediaStream,
	MediaTools,
} from "../../../platform/media/index.js";
import {
	checkExecutionCapabilities,
	MediaExecutionCapabilityError,
	MediaOutputBudgetError,
	MediaToolError,
} from "../../../platform/media/index.js";
import type { MediaProcessEvent } from "../../../shared/media-execution.js";
import type { MediaProcessingPlan } from "../../../shared/media-processing.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { MediaInspectionApi } from "../../media-inspection/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import {
	type MediaProcessingPolicy,
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "../domain/policy.js";
import {
	MediaProcessingFiles,
	type ProcessingWorkspace,
} from "../infrastructure/files.js";

/** An adapter must await child closure on cancellation. The production FFmpeg adapter is composed separately. */
export interface MediaExecutionAdapter {
	execute(
		input: string,
		output: string,
		options: MediaProcessingOptions,
		info: MediaInfo,
	): Promise<void>;
}

export interface MediaExecutionRequest {
	fileId: string;
	sourceVersion: string;
	plan: DeepReadonly<MediaProcessingPlan>;
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
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
export class MediaProcessingApplication {
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
			tools: Pick<MediaTools, "capabilities" | "probe">;
			executor: MediaExecutionAdapter;
			dataDir: string;
			policy?: DeepReadonly<MediaProcessingPolicy>;
			logger?: Logger;
		},
	) {
		const policy = options.policy ?? mediaProcessingPolicy;
		validateMediaProcessingPolicy(policy);
		this.policy = freeze(structuredClone(policy));
		this.files = new MediaProcessingFiles(options.dataDir);
	}
	start(request: MediaExecutionRequest): MediaExecutionHandle {
		if (
			request.maximumBytes !== undefined &&
			(!Number.isSafeInteger(request.maximumBytes) || request.maximumBytes <= 0)
		)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Invalid execution output budget.",
			);
		const plan = freeze(structuredClone(request.plan));
		if (
			typeof plan.id !== "string" ||
			!plan.id ||
			typeof plan.container !== "string" ||
			!plan.container ||
			typeof plan.outputFormat !== "string" ||
			!plan.outputFormat ||
			!Array.isArray(plan.filters) ||
			!plan.filters.every(
				(filter) => typeof filter === "string" && filter.length > 0,
			) ||
			![plan.video, plan.audio].every(
				(stream) =>
					stream?.action === "copy" ||
					(stream?.action === "encode" &&
						typeof stream.encoder === "string" &&
						stream.encoder.length > 0 &&
						typeof stream.codec === "string" &&
						stream.codec.length > 0 &&
						(stream.pixelFormat === undefined ||
							(typeof stream.pixelFormat === "string" &&
								stream.pixelFormat.length > 0))),
			)
		)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Invalid explicit execution requirements.",
			);
		if (
			!Number.isSafeInteger(request.videoStreamIndex) ||
			request.videoStreamIndex < 0 ||
			!Array.isArray(request.audioStreamIndices) ||
			new Set(request.audioStreamIndices).size !==
				request.audioStreamIndices.length ||
			request.audioStreamIndices.some(
				(index) => !Number.isSafeInteger(index) || index < 0,
			)
		)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Invalid explicit execution selection.",
			);
		return this.launch({ ...request, plan });
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
		const maximumBytes = Math.min(
			this.policy.maximumProcessedBytes - retainedBytes,
			request.maximumBytes ?? this.policy.maximumProcessedBytes,
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
				join(source.identity.canonicalRoot, source.identity.relativePath),
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
			const videos = output.streams.filter((stream) => stream.type === "video");
			const audios = output.streams.filter((stream) => stream.type === "audio");
			if (
				videos.length !== 1 ||
				audios.length !== selectedAudios.length ||
				videos[0]?.codec !==
					(plan.video.action === "encode" ? plan.video.codec : video.codec) ||
				selectedAudios.some(
					(audio, index) =>
						audios[index]?.codec !==
						(plan.audio.action === "encode" ? plan.audio.codec : audio.codec),
				) ||
				!output.formatAliases.includes(plan.outputFormat)
			)
				throw new MediaToolError(
					"TOOL_FAILED",
					"Output does not match explicit execution requirements.",
				);
			if (
				(plan.video.action === "encode" &&
					plan.video.pixelFormat &&
					videos[0]?.pixelFormat !== plan.video.pixelFormat) ||
				(plan.videoParameters?.maxHeight !== undefined &&
					(videos[0]?.height === null ||
						(videos[0]?.height ?? Infinity) >
							plan.videoParameters.maxHeight)) ||
				(plan.audioParameters?.channels === "stereo" &&
					audios.some((audio) => audio.channels !== 2)) ||
				((plan.audio.action === "copy" ||
					plan.audioParameters?.channels === "preserve") &&
					selectedAudios.some(
						(audio, index) =>
							audio.channels !== null &&
							audios[index]?.channels !== audio.channels,
					)) ||
				(plan.h264Level && videos[0]?.codecString !== "avc1.640033")
			)
				throw new MediaToolError(
					"TOOL_FAILED",
					"Output does not match encoding constraints.",
				);
			const before = video.duration ?? info.duration;
			const after = videos[0]?.duration ?? output.duration;
			if (
				before !== null &&
				after !== null &&
				Math.abs(before - after) > this.policy.durationToleranceSeconds
			)
				throw new MediaToolError(
					"TOOL_FAILED",
					"Output duration does not match the source.",
				);

			for (const [index, audio] of selectedAudios.entries()) {
				const audioBefore = audio.duration;
				const audioAfter = audios[index]?.duration;
				if (
					audioBefore != null &&
					audioAfter != null &&
					Math.abs(audioBefore - audioAfter) >
						this.policy.durationToleranceSeconds
				)
					throw new MediaToolError(
						"TOOL_FAILED",
						"Output audio duration does not match the source.",
					);
			}
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
