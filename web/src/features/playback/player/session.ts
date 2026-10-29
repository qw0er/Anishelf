import {
	type MediaTimeline,
	mediaTimeMs,
	originalTimeline,
	sourceTimeMs,
} from "@anishelf/backend/contracts/media";
import {
	ApiClientError,
	isRequestCancelled,
	type RequestOptions,
} from "../../../shared/api/client.js";
import type {
	PlaybackSessionResponse,
	SavePlaybackProgressRequest,
} from "../../../shared/api/contracts.js";
import {
	openPlaybackSession,
	releasePlaybackSession,
	savePlaybackProgress,
} from "./api.js";
import type { PlaybackPolicy } from "./policy.js";

export interface PlaybackSessionState {
	session: PlaybackSessionResponse | null;
	loading: boolean;
	saving: boolean;
	restored: boolean;
	error: { operation: "load" | "save"; cause: unknown } | null;
}

import { PlaybackEvidence } from "./evidence.js";

type Position = Pick<SavePlaybackProgressRequest, "positionMs" | "durationMs">;

export function isRetryablePlaybackError(cause: unknown): boolean {
	if (isRequestCancelled(cause)) return true;
	return (
		cause instanceof ApiClientError &&
		(cause.kind === "network" ||
			(cause.kind === "http" &&
				(cause.status === 408 ||
					cause.status === 429 ||
					(cause.status !== null && cause.status >= 500))))
	);
}

/** Owns one file's progress lifecycle; React and the media player are adapters. */
export class PlaybackSessionController {
	private state: PlaybackSessionState = {
		session: null,
		loading: true,
		saving: false,
		restored: false,
		error: null,
	};
	private evidence = new PlaybackEvidence();
	private naturalEnd = false;
	private playing = false;
	private video: HTMLVideoElement | null = null;
	private timeline: MediaTimeline = originalTimeline();
	private metadataReady = false;
	private position: Position | null = null;
	private sequence = 0;
	private pending: SavePlaybackProgressRequest | null = null;
	private inFlight: SavePlaybackProgressRequest | null = null;
	private sending: Promise<boolean> | null = null;
	private opening: Promise<void> | null = null;
	private closed = false;
	private keepalive = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private seekTimer: ReturnType<typeof setTimeout> | undefined;
	private retryDelayMs = 0;
	private detachEvents: (() => void) | undefined;
	private lastSaved: SavePlaybackProgressRequest | null = null;
	private readonly fileId: string;
	private readonly notify: (state: PlaybackSessionState) => void;
	private readonly policy: PlaybackPolicy;
	constructor(
		fileId: string,
		notify: (state: PlaybackSessionState) => void,
		policy: PlaybackPolicy,
	) {
		this.policy = policy;
		this.fileId = fileId;
		this.notify = notify;
	}

	async open(after: Promise<unknown> = Promise.resolve()): Promise<void> {
		if (this.opening) return this.opening;
		this.opening = (async () => {
			await after;
			if (this.closed) return;
			clearTimeout(this.retryTimer);
			this.retryDelayMs = 0;
			this.publish({
				session: null,
				loading: true,
				restored: false,
				error: null,
			});
			try {
				const session = await this.request((options) =>
					openPlaybackSession(this.fileId, options),
				);
				this.sequence = session.progress.lastSequence;
				this.evidence = new PlaybackEvidence();
				this.naturalEnd = false;
				this.position = null;
				this.pending = null;
				this.lastSaved = null;
				this.publish({ session, loading: false });
				if (!this.closed) this.restore();
			} catch (cause) {
				this.publish({ loading: false, error: { operation: "load", cause } });
			}
		})().finally(() => {
			this.opening = null;
		});
		return this.opening;
	}

	attach(
		video: HTMLVideoElement | null,
		timeline: MediaTimeline = originalTimeline(),
	): void {
		this.sampleEvidence();
		this.evidence.reset();
		this.playing = false;
		this.capture();
		this.detachEvents?.();
		clearInterval(this.timer);
		clearTimeout(this.seekTimer);
		this.video = video;
		this.timeline = timeline;
		this.metadataReady = (video?.readyState ?? 0) >= 1;
		if (!video || this.closed) return;
		this.publish({ restored: false });
		const metadata = () => {
			this.metadataReady = true;
			this.restore();
		};
		const seeked = () => {
			this.evidence.reset();
			this.playing = !video.paused && !video.ended;
			this.sampleEvidence();
			if (!this.state.restored) this.finishRestore();
			else {
				this.capture();
				clearTimeout(this.seekTimer);
				this.seekTimer = setTimeout(
					() => this.queueSave(),
					this.policy.progressSeekDelayMs,
				);
			}
		};
		const sample = () => this.sampleEvidence();
		const playing = () => {
			if (!video.ended) this.naturalEnd = false;
			this.evidence.reset();
			this.playing = true;
			sample();
		};
		const interrupt = () => {
			this.naturalEnd = false;
			this.playing = false;
			this.evidence.reset();
		};
		const stop = () => {
			sample();
			interrupt();
		};
		const save = () => {
			stop();
			this.queueSave();
		};
		const ended = () => {
			stop();
			const duration = this.timeline.sourceDurationMs;
			this.naturalEnd =
				duration === null
					? this.timeline.sourceOriginMs === 0 &&
						this.timeline.mediaOriginMs === 0
					: sourceTimeMs(video.currentTime * 1000, this.timeline) >=
						duration - 1000;
			this.queueSave(true);
		};
		const events: [string, () => void][] = [
			["playing", playing],
			["timeupdate", sample],
			["seeking", interrupt],
			["waiting", interrupt],
			["stalled", interrupt],
			["ratechange", playing],
		];
		for (const [name, handler] of events) video.addEventListener(name, handler);
		video.addEventListener("loadedmetadata", metadata);
		video.addEventListener("seeked", seeked);
		video.addEventListener("pause", save);
		video.addEventListener("ended", ended);
		this.detachEvents = () => {
			for (const [name, handler] of events)
				video.removeEventListener(name, handler);
			video.removeEventListener("loadedmetadata", metadata);
			video.removeEventListener("seeked", seeked);
			video.removeEventListener("pause", save);
			video.removeEventListener("ended", ended);
		};
		this.timer = setInterval(() => {
			if (!video.paused && !video.ended) this.queueSave();
		}, this.policy.progressSaveIntervalMs);
		this.restore();
	}

	async retry(): Promise<void> {
		if (this.closed) return;
		const error = this.state.error;
		if (
			!this.state.session ||
			error?.operation === "load" ||
			(error?.cause instanceof ApiClientError &&
				error.cause.code === "PLAYBACK_CONFLICT")
		) {
			if (this.state.session) await this.release();
			await this.open();
		} else {
			this.queueSave(false, true);
			await this.sending;
		}
	}

	reconnect(): void {
		if (
			!this.closed &&
			this.state.error?.operation === "save" &&
			isRetryablePlaybackError(this.state.error.cause)
		)
			this.queueSave(false, true);
	}

	async flush(keepalive = false): Promise<boolean> {
		if (this.closed) return false;
		this.keepalive ||= keepalive;
		if (!this.state.session || !this.state.restored) return true;
		if (this.state.error && !isRetryablePlaybackError(this.state.error.cause))
			return false;
		this.queueSave(false, true);
		return (await this.sending) ?? this.state.error === null;
	}

	async dispose(): Promise<void> {
		if (this.closed) return;
		this.sampleEvidence();
		this.evidence.reset();
		this.playing = false;
		this.capture();
		this.detachEvents?.();
		clearInterval(this.timer);
		clearTimeout(this.retryTimer);
		clearTimeout(this.seekTimer);
		this.video = null;
		this.closed = true;
		await this.opening;
		await this.sending;
		if (
			this.state.restored &&
			(!this.state.error || isRetryablePlaybackError(this.state.error.cause))
		)
			this.queueSave(false, true);
		await this.sending;
		await this.release();
	}

	private restore(): void {
		const { session } = this.state;
		const video = this.video;
		if (
			!session ||
			!video ||
			!this.metadataReady ||
			this.state.restored ||
			this.state.error?.operation === "load" ||
			this.closed
		)
			return;
		const duration =
			Number.isFinite(video.duration) && video.duration > 0
				? video.duration
				: null;
		const target =
			duration === null
				? mediaTimeMs(
						this.position?.positionMs ?? session.progress.positionMs,
						this.timeline,
					) / 1000
				: Math.min(
						mediaTimeMs(
							this.position?.positionMs ?? session.progress.positionMs,
							this.timeline,
						) / 1000,
						duration,
					);
		try {
			video.currentTime = target;
			if (!video.seeking) this.finishRestore();
		} catch (cause) {
			this.publish({ error: { operation: "load", cause } });
		}
	}
	private finishRestore(): void {
		if (
			this.state.restored ||
			!this.state.session ||
			this.state.error?.operation === "load" ||
			this.closed
		)
			return;
		this.publish({ restored: true });
		this.capture();
	}
	private sampleEvidence() {
		if (this.video && this.state.restored)
			this.evidence.sample(this.video, this.playing);
	}
	private capture(ended = false): void {
		const video = this.video;
		if (!video || !this.state.restored) return;
		const durationMs =
			this.timeline.sourceDurationMs ??
			(this.timeline.sourceOriginMs === 0 &&
			this.timeline.mediaOriginMs === 0 &&
			Number.isFinite(video.duration) &&
			video.duration > 0
				? Math.round(video.duration * 1000)
				: null);
		const localPosition =
			(ended || video.ended) && Number.isFinite(video.duration)
				? video.duration
				: video.currentTime;
		const positionMs = sourceTimeMs(localPosition * 1000, this.timeline);
		if (
			!Number.isSafeInteger(positionMs) ||
			positionMs < 0 ||
			(durationMs !== null &&
				(!Number.isSafeInteger(durationMs) || durationMs <= 0))
		)
			return;
		this.position = {
			positionMs:
				durationMs === null ? positionMs : Math.min(positionMs, durationMs),
			durationMs,
		};
	}
	private queueSave(ended = false, retry = false): void {
		clearTimeout(this.seekTimer);
		this.sampleEvidence();
		this.capture(ended);
		const session = this.state.session;
		if (!session || !this.state.restored || !this.position) return;

		// Preserve sequence/payload for an ambiguous failed write unless a newer position exists.
		const latest = this.pending ?? this.inFlight ?? this.lastSaved;
		if (
			!latest ||
			latest.positionMs !== this.position.positionMs ||
			latest.durationMs !== this.position.durationMs ||
			latest.normalPlayedMs !== this.evidence.normalPlayedMs ||
			latest.naturalEnd !== this.naturalEnd
		) {
			this.pending = {
				normalPlayedMs: this.evidence.normalPlayedMs,
				naturalEnd: this.naturalEnd,
				generation: session.progress.generation,
				sourceVersion: session.sourceVersion,
				sequence: ++this.sequence,
				...this.position,
			};
		}
		if (!this.pending || (this.state.error && !retry)) return;
		clearTimeout(this.retryTimer);
		if (!this.sending) {
			this.sending = this.drain().finally(() => {
				this.sending = null;
			});
		}
	}
	private async drain(): Promise<boolean> {
		this.publish({ saving: true });
		try {
			while (this.pending) {
				const payload = this.pending;
				this.pending = null;
				this.inFlight = payload;
				const session = this.state.session;
				if (!session) return false;
				try {
					if (typeof navigator !== "undefined" && !navigator.onLine)
						throw new ApiClientError({
							kind: "network",
							message: "Browser is offline.",
						});
					const result = await this.request((options) =>
						savePlaybackProgress(session.token, payload, options),
					);
					this.lastSaved = payload;
					if (this.state.error?.operation === "save")
						console.info("[playback] Progress synchronization recovered.", {
							fileId: this.fileId,
						});
					this.retryDelayMs = 0;
					this.publish({
						session: { ...session, progress: result.progress },
						error: null,
					});
				} catch (cause) {
					this.retainFailed(payload);
					this.saveFailed(cause);
					return false;
				} finally {
					this.inFlight = null;
				}
			}
			return true;
		} finally {
			this.publish({ saving: false });
		}
	}
	private retainFailed(payload: SavePlaybackProgressRequest) {
		this.pending ??= payload;
	}
	private saveFailed(cause: unknown): void {
		const retryable = isRetryablePlaybackError(cause);
		if (!this.state.error || !retryable)
			console.warn("[playback] Progress synchronization failed.", {
				fileId: this.fileId,
				retryable,
				kind:
					cause instanceof ApiClientError ? cause.kind : "timeout-or-unknown",
				status: cause instanceof ApiClientError ? cause.status : null,
				code: cause instanceof ApiClientError ? cause.code : null,
				requestId: cause instanceof ApiClientError ? cause.requestId : null,
			});
		this.publish({ error: { operation: "save", cause } });
		if (this.closed || !retryable) return;
		this.retryDelayMs = Math.min(
			this.retryDelayMs > 0
				? this.retryDelayMs * 2
				: this.policy.progressRetryInitialMs,
			this.policy.progressRetryMaximumMs,
		);
		this.retryTimer = setTimeout(() => {
			this.queueSave(false, true);
		}, this.retryDelayMs);
	}
	private async release(): Promise<void> {
		const session = this.state.session;
		if (!session) return;
		if (typeof navigator !== "undefined" && !navigator.onLine) return;
		try {
			await this.request((options) =>
				releasePlaybackSession(session.token, options),
			);
		} catch {
			/* Server idle expiry bounds cleanup after a failed release. */
		}
	}
	private async request<T>(
		operation: (options: RequestOptions) => Promise<T>,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			this.policy.requestTimeoutMs,
		);
		try {
			return await operation({
				signal: controller.signal,
				keepalive: this.keepalive,
			});
		} finally {
			clearTimeout(timer);
		}
	}
	private publish(change: Partial<PlaybackSessionState>): void {
		this.state = { ...this.state, ...change };
		if (!this.closed) this.notify(this.state);
	}
}
