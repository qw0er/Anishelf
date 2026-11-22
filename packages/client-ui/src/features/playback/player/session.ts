import {
	type MediaTimeline,
	mediaTimeMs,
	sourceTimeMs,
} from "@anishelf/contracts/media";
import type {
	LibmediaPlaybackProgress,
	LibmediaPlaybackState,
	LibmediaPlayerEvents,
} from "libmedia-react-player";
import {
	ApiClientError,
	isRequestCancelled,
	type RequestOptions,
} from "../../../shared/api/client.js";
import { getClientRuntime } from "../../../shared/api/connection.js";
import type {
	PlaybackSessionResponse,
	SavePlaybackProgressRequest,
} from "../../../shared/api/contracts.js";
import {
	openPlaybackSession,
	releasePlaybackSession,
	savePlaybackProgress,
} from "./api.js";
import { PlaybackEvidence } from "./evidence.js";
import type { PlaybackPolicy } from "./policy.js";
import { capturePlaybackPosition, type Position } from "./progress-position.js";

export interface PlaybackSessionState {
	session: PlaybackSessionResponse | null;
	loading: boolean;
	saving: boolean;
	restored: boolean;
	error: { operation: "load" | "save"; cause: unknown } | null;
}

export interface PlaybackBinding {
	initialPositionMs: number;
	events: Pick<
		LibmediaPlayerEvents,
		| "onPlaybackStateChange"
		| "onInitialPositionResult"
		| "onReady"
		| "onTimeUpdate"
		| "onSeeked"
		| "onEnded"
	>;
	accepts(sessionId: string): boolean;
	dispose(): void;
}

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
	private binding: PlaybackBinding | null = null;
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
			} catch (cause) {
				this.publish({ loading: false, error: { operation: "load", cause } });
			}
		})().finally(() => {
			this.opening = null;
		});
		return this.opening;
	}

	bind(timeline: MediaTimeline, sourceVersion: string): PlaybackBinding | null {
		const { session } = this.state;
		if (!session || this.closed || session.sourceVersion !== sourceVersion)
			return null;

		this.binding?.dispose();
		if (this.position && this.state.restored) this.queueSave();
		const previous = this.position ?? session.progress;
		const duration = timeline.sourceDurationMs ?? previous.durationMs;
		const initialPositionMs =
			duration !== null && previous.positionMs >= duration - 100
				? 0
				: mediaTimeMs(previous.positionMs, timeline);

		let state: LibmediaPlaybackState | undefined;
		const retired = new Set<string>();
		let mediaPositionMs: number | undefined;
		let restoredAttempt: string | undefined;
		let ended = false;
		const active = () => !this.closed && this.binding === binding;
		const accepts = (id: string) => active() && state?.sessionId === id;
		const capture = (progress: LibmediaPlaybackProgress, atEnd = false) => {
			const position = capturePlaybackPosition(progress, timeline, atEnd);
			if (position) {
				this.position = position;
				mediaPositionMs = atEnd
					? (progress.durationMs ?? progress.positionMs)
					: progress.positionMs;
			}
		};
		const playing = () =>
			state?.status === "playing" && !state.buffering && !state.seeking;
		const sample = () => {
			if (playing() && state && mediaPositionMs !== undefined)
				this.evidence.sample(mediaPositionMs, state.playbackRate);
		};
		const binding: PlaybackBinding = {
			initialPositionMs,
			accepts,
			events: {
				onPlaybackStateChange: (next) => {
					if (!active() || retired.has(next.sessionId)) return;
					if (state && next.sessionId !== state.sessionId) {
						if (next.status !== "loading") return;
						// React can restart the player's effects while keeping this binding.
						retired.add(state.sessionId);
						if (restoredAttempt !== next.sessionId) restoredAttempt = undefined;
						ended = false;
						this.evidence.reset();
						this.publish({ restored: false });
					}
					const wasPlaying = playing();
					const changedRate = next.playbackRate !== state?.playbackRate;
					const isPaused =
						next.status === "paused" && state?.status !== "paused";
					if (
						next.status !== "playing" ||
						next.seeking ||
						next.buffering ||
						changedRate
					)
						this.evidence.reset();
					if (next.status === "playing" && state?.status !== "playing") {
						ended = false;
						this.naturalEnd = false;
					}
					state = next;
					if (this.state.restored && (!wasPlaying || changedRate)) sample();
					if (isPaused && this.state.restored) this.queueSave();
				},
				onInitialPositionResult: (result) => {
					if (active() && !retired.has(result.sessionId))
						restoredAttempt = result.restored ? result.sessionId : undefined;
				},
				onReady: (progress) => {
					if (
						!accepts(progress.sessionId) ||
						restoredAttempt !== progress.sessionId ||
						this.state.restored
					)
						return;
					capture(progress);
					this.publish({ restored: true });
				},
				onTimeUpdate: (progress) => {
					if (
						!accepts(progress.sessionId) ||
						!this.state.restored ||
						state?.seeking
					)
						return;
					capture(progress);
					sample();
				},
				onSeeked: (progress) => {
					if (!accepts(progress.sessionId) || !this.state.restored) return;
					ended = false;
					this.naturalEnd = false;
					this.evidence.reset();
					capture(progress);
					sample();
					clearTimeout(this.seekTimer);
					this.seekTimer = setTimeout(
						() => this.queueSave(),
						this.policy.progressSeekDelayMs,
					);
				},
				onEnded: (progress) => {
					if (!accepts(progress.sessionId) || !this.state.restored || ended)
						return;
					ended = true;
					this.evidence.reset();
					const duration = timeline.sourceDurationMs;
					const end = progress.durationMs ?? progress.positionMs;
					this.naturalEnd =
						duration === null
							? timeline.sourceOriginMs === 0 && timeline.mediaOriginMs === 0
							: sourceTimeMs(end, timeline) >= duration - 1000;
					capture(progress, true);
					this.queueSave();
				},
			},
			dispose: () => {
				if (!active()) return;
				this.clearBinding();
			},
		};
		this.binding = binding;
		this.naturalEnd = false;
		this.publish({ restored: false });
		this.timer = setInterval(() => {
			if (this.state.restored && playing()) this.queueSave();
		}, this.policy.progressSaveIntervalMs);
		return binding;
	}

	private clearBinding(): void {
		this.binding = null;
		this.evidence.reset();
		clearInterval(this.timer);
		clearTimeout(this.seekTimer);
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
			this.clearBinding();
			if (this.sending) await this.sending;
			if (this.state.session) await this.release();
			await this.open();
		} else {
			this.queueSave(true);
			await this.sending;
		}
	}

	reconnect(): void {
		if (
			!this.closed &&
			this.state.error?.operation === "save" &&
			isRetryablePlaybackError(this.state.error.cause)
		)
			this.queueSave(true);
	}

	async flush(keepalive = false): Promise<boolean> {
		if (this.closed) return false;
		this.keepalive ||= keepalive;
		if (!this.state.session || !this.position) return true;
		if (this.state.error && !isRetryablePlaybackError(this.state.error.cause))
			return false;
		this.queueSave(true);
		return (await this.sending) ?? this.state.error === null;
	}

	async dispose(): Promise<void> {
		if (this.closed) return;
		this.clearBinding();
		clearTimeout(this.retryTimer);
		this.closed = true;
		await this.opening;
		await this.sending;
		if (
			this.position &&
			(!this.state.error || isRetryablePlaybackError(this.state.error.cause))
		)
			this.queueSave(true);
		await this.sending;
		await this.release();
	}

	private queueSave(retry = false): void {
		clearTimeout(this.seekTimer);
		const session = this.state.session;
		if (!session || !this.position) return;

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
					if (!getClientRuntime().platform.isOnline())
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
			this.queueSave(true);
		}, this.retryDelayMs);
	}
	private async release(): Promise<void> {
		const session = this.state.session;
		if (!session) return;
		if (!getClientRuntime().platform.isOnline()) return;
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
