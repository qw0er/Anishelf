import type {
	LibmediaPlaybackProgress,
	LibmediaPlaybackSnapshot,
	LibmediaPlaybackState,
	LibmediaPlayerHandle,
} from "libmedia-react-player";
import {
	type RefObject,
	useCallback,
	useEffectEvent,
	useLayoutEffect,
	useRef,
} from "react";
import { getClientRuntime } from "../../shared/api/connection.js";
import type {
	SystemMediaAction,
	SystemMediaSession,
} from "../../shared/platform.js";

type Attempt = Pick<
	LibmediaPlaybackProgress & LibmediaPlaybackState,
	| "sessionId"
	| "status"
	| "seeking"
	| "positionMs"
	| "durationMs"
	| "playbackRate"
> & {
	session?: SystemMediaSession;
	releaseDisplay?: () => void;
};

async function runAction(
	player: LibmediaPlayerHandle,
	attempt: Attempt,
	action: SystemMediaAction,
) {
	if (action.kind === "play") {
		if (attempt.status === "paused") await player.play();
		return;
	}
	if (action.kind === "pause") {
		if (attempt.status === "playing") await player.pause();
		return;
	}
	const { durationMs, positionMs, status } = attempt;
	if (status !== "playing" && status !== "paused") return;
	if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0)
		return;
	const target =
		action.kind === "seekTo" ? action.positionMs : positionMs + action.offsetMs;
	if (Number.isFinite(target))
		await player.seekTo(Math.round(Math.max(0, Math.min(target, durationMs))));
}

export function useSystemPlayback(
	player: RefObject<LibmediaPlayerHandle | null>,
	title: string,
	{
		artworkUrl,
		checkpoint,
	}: {
		artworkUrl?: string | undefined;
		checkpoint(snapshot: LibmediaPlaybackSnapshot): void;
	},
) {
	const { connection, platform } = getClientRuntime();
	const { systemMedia: host, keepDisplayAwake, onSystemPause } = platform;
	const signal = connection.signal;
	const attempt = useRef<Attempt>(null);
	const saveCheckpoint = useEffectEvent(checkpoint);

	const close = useCallback(() => {
		const current = attempt.current;
		attempt.current = null;
		current?.releaseDisplay?.();
		current?.session?.close();
	}, []);
	useLayoutEffect(() => {
		if (!host && !keepDisplayAwake) return;
		signal.addEventListener("abort", close, { once: true });
		return () => {
			signal.removeEventListener("abort", close);
			close();
		};
	}, [close, host, keepDisplayAwake, signal]);
	useLayoutEffect(() => {
		attempt.current?.session?.setMetadata({ title, artworkUrl });
	}, [title, artworkUrl]);
	useLayoutEffect(() => {
		if (!onSystemPause) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pausing: string | undefined;

		async function pause(
			handle: LibmediaPlayerHandle,
			sessionId: string,
			retries: number,
		): Promise<void> {
			const active = () =>
				pausing === sessionId &&
				player.current === handle &&
				!signal.aborted &&
				handle.getSnapshot().sessionId === sessionId;
			if (!active()) return;
			let pauseError: unknown;
			try {
				const { status, seeking } = handle.getSnapshot();
				if (status === "playing" && !seeking) {
					await handle.pause();
					if (active()) pausing = undefined;
					return;
				}
			} catch (error) {
				pauseError = error;
			}
			if (!active()) return;
			const { status } = handle.getSnapshot();
			const stillPlaying = status === "playing" || status === "starting";
			// The player serializes pause with in-flight seeks and track changes.
			if (stillPlaying && retries > 0) {
				timer = setTimeout(
					() => void pause(handle, sessionId, retries - 1),
					100,
				);
				return;
			}
			pausing = undefined;
			if (stillPlaying || pauseError)
				console.warn("playback.system_pause_failed", {
					status,
					error: pauseError,
				});
		}

		const stop = onSystemPause(() => {
			const handle = player.current;
			if (!handle || signal.aborted) return;
			const snapshot = handle.getSnapshot();
			const { sessionId, status } = snapshot;
			if (status !== "playing" && status !== "starting" && status !== "paused")
				return;

			// Dispatch the save before waiting for the decoder or the OS to suspend.
			saveCheckpoint(snapshot);
			if (status === "paused" || pausing === sessionId) return;
			clearTimeout(timer);
			pausing = sessionId;
			void pause(handle, sessionId, 30);
		});
		return () => {
			stop();
			pausing = undefined;
			clearTimeout(timer);
		};
	}, [onSystemPause, player, signal]);

	function publish(current: Attempt) {
		const { status, seeking, positionMs, durationMs, playbackRate } = current;
		if (!host || seeking || (status !== "playing" && status !== "paused"))
			return;
		if (!current.session) {
			if (status !== "playing") return;
			current.session = host.open({ title, artworkUrl }, async (action) => {
				const handle = player.current;
				if (handle && attempt.current === current && current.session)
					await runAction(handle, current, action);
			});
		}
		current.session.update({ status, positionMs, durationMs, playbackRate });
	}

	return {
		ready({ sessionId, positionMs, durationMs }: LibmediaPlaybackProgress) {
			if (
				(!host && !keepDisplayAwake) ||
				signal.aborted ||
				attempt.current?.sessionId === sessionId
			)
				return;
			close();
			attempt.current = {
				sessionId,
				positionMs,
				durationMs,
				status: "ready",
				playbackRate: 1,
				seeking: false,
			};
		},
		playbackStateChanged(event: LibmediaPlaybackState) {
			const current = attempt.current;
			if (!current) return;
			const { sessionId, status, seeking, playbackRate } = event;
			if (status === "loading") {
				close();
				return;
			}
			if (current.sessionId !== sessionId) return;
			if (status === "error") {
				close();
				return;
			}
			current.status = status;
			current.seeking = seeking;
			current.playbackRate = playbackRate;
			if (status === "playing" && keepDisplayAwake) {
				current.releaseDisplay ??= keepDisplayAwake();
			} else {
				current.releaseDisplay?.();
				delete current.releaseDisplay;
			}
			if (status === "ended") {
				current.session?.close();
				delete current.session;
				return;
			}
			publish(current);
		},
		positionChanged({
			sessionId,
			positionMs,
			durationMs,
		}: LibmediaPlaybackProgress) {
			const current = attempt.current;
			if (current?.sessionId !== sessionId || current.seeking) return;
			current.positionMs = positionMs;
			current.durationMs = durationMs;
			publish(current);
		},
		close,
	};
}
