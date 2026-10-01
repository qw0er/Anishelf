import {
	ApiClientError,
	openPlaybackSession,
	type RequestOptions,
	releasePlaybackSession,
	savePlaybackProgress,
} from "../api/client.js";
import type {
	PlaybackSessionResponse,
	SavePlaybackProgressRequest,
} from "../api/contracts.js";

export interface PlaybackSessionState {
	session: PlaybackSessionResponse | null;
	loading: boolean;
	saving: boolean;
	restored: boolean;
	error: { operation: "load" | "save"; cause: unknown } | null;
}
type Position = Pick<SavePlaybackProgressRequest, "positionMs" | "durationMs">;
const requestTimeoutMs = 5000;

/** Owns one file's progress lifecycle; React and the media player are adapters. */
export class PlaybackSessionController {
	private state: PlaybackSessionState = {
		session: null,
		loading: true,
		saving: false,
		restored: false,
		error: null,
	};
	private video: HTMLVideoElement | null = null;
	private metadataReady = false;
	private position: Position | null = null;
	private sequence = 0;
	private pending: SavePlaybackProgressRequest | null = null;
	private sending: Promise<boolean> | null = null;
	private opening: Promise<void> | null = null;
	private closed = false;
	private keepalive = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private detachEvents: (() => void) | undefined;
	private lastSaved: Position | null = null;
	private readonly fileId: string;
	private readonly notify: (state: PlaybackSessionState) => void;
	constructor(fileId: string, notify: (state: PlaybackSessionState) => void) {
		this.fileId = fileId;
		this.notify = notify;
	}

	async open(after: Promise<unknown> = Promise.resolve()): Promise<void> {
		if (this.opening) return this.opening;
		this.opening = (async () => {
			await after;
			if (this.closed) return;
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

	attach(video: HTMLVideoElement | null): void {
		this.capture();
		this.detachEvents?.();
		clearInterval(this.timer);
		this.video = video;
		this.metadataReady = (video?.readyState ?? 0) >= 1;
		if (!video || this.closed) return;
		this.publish({ restored: false });
		const metadata = () => {
			this.metadataReady = true;
			this.restore();
		};
		const seeked = () => {
			if (!this.state.restored) this.finishRestore();
			else this.queueSave();
		};
		const save = () => this.queueSave();
		const ended = () => this.queueSave(true);
		video.addEventListener("loadedmetadata", metadata);
		video.addEventListener("seeked", seeked);
		video.addEventListener("pause", save);
		video.addEventListener("ended", ended);
		this.detachEvents = () => {
			video.removeEventListener("loadedmetadata", metadata);
			video.removeEventListener("seeked", seeked);
			video.removeEventListener("pause", save);
			video.removeEventListener("ended", ended);
		};
		this.timer = setInterval(() => {
			if (!video.paused && !video.ended) this.queueSave();
		}, 5000);
		this.restore();
	}

	async retry(): Promise<void> {
		const error = this.state.error;
		if (
			!this.state.session ||
			error?.operation === "load" ||
			(error?.cause instanceof ApiClientError &&
				error.cause.code === "PLAYBACK_CONFLICT")
		) {
			if (this.state.session) await this.release();
			await this.open();
		} else await this.flush();
	}

	async flush(keepalive = false): Promise<boolean> {
		this.keepalive ||= keepalive;
		if (!this.state.session || !this.state.restored) return true;
		this.queueSave(false, true);
		return (await this.sending) ?? this.state.error === null;
	}

	async dispose(): Promise<void> {
		this.capture();
		this.detachEvents?.();
		clearInterval(this.timer);
		this.video = null;
		this.closed = true;
		await this.opening;
		if (this.state.restored && !this.state.error) this.queueSave(false, true);
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
			this.state.error ||
			this.closed
		)
			return;
		const duration =
			Number.isFinite(video.duration) && video.duration > 0
				? video.duration
				: null;
		const target =
			duration === null
				? (this.position?.positionMs ?? session.progress.positionMs) / 1000
				: Math.min(
						(this.position?.positionMs ?? session.progress.positionMs) / 1000,
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
			this.state.error ||
			this.closed
		)
			return;
		this.publish({ restored: true });
		this.capture();
	}
	private capture(ended = false): void {
		const video = this.video;
		if (!video || !this.state.restored) return;
		const durationMs =
			Number.isFinite(video.duration) && video.duration > 0
				? Math.round(video.duration * 1000)
				: null;
		const positionMs = Math.round(
			((ended || video.ended) && durationMs !== null
				? video.duration
				: video.currentTime) * 1000,
		);
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
		this.capture(ended);
		const session = this.state.session;
		if (
			!session ||
			!this.state.restored ||
			!this.position ||
			(this.state.error && !retry)
		)
			return;
		if (
			!this.pending &&
			this.lastSaved?.positionMs === this.position.positionMs &&
			this.lastSaved.durationMs === this.position.durationMs &&
			!this.state.error
		)
			return;
		// Preserve sequence/payload for an ambiguous failed write unless a newer position exists.
		if (
			!this.pending ||
			this.pending.positionMs !== this.position.positionMs ||
			this.pending.durationMs !== this.position.durationMs
		) {
			this.pending = {
				generation: session.generation,
				sourceVersion: session.sourceVersion,
				sequence: ++this.sequence,
				...this.position,
			};
		}
		this.publish({ error: null });
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
				const session = this.state.session;
				if (!session) return false;
				try {
					const result = await this.request((options) =>
						savePlaybackProgress(session.token, payload, options),
					);
					this.lastSaved = {
						positionMs: payload.positionMs,
						durationMs: payload.durationMs,
					};
					this.publish({
						session: { ...session, progress: result.progress },
						error: null,
					});
				} catch (cause) {
					this.pending ??= payload;
					this.publish({ error: { operation: "save", cause } });
					return false;
				}
			}
			return true;
		} finally {
			this.publish({ saving: false });
		}
	}
	private async release(): Promise<void> {
		const session = this.state.session;
		if (!session) return;
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
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
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
