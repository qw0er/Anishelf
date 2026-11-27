import type {
	LibmediaPlaybackProgress,
	LibmediaPlaybackState,
	LibmediaPlayerHandle,
} from "libmedia-react-player";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
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
> & { session?: SystemMediaSession };

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

export function useSystemMediaSession(
	player: RefObject<LibmediaPlayerHandle | null>,
	title: string,
	artworkUrl?: string,
) {
	const { connection, platform } = getClientRuntime();
	const host = platform.systemMedia;
	const signal = connection.signal;
	const attempt = useRef<Attempt>(null);

	const close = useCallback(() => {
		const current = attempt.current;
		attempt.current = null;
		current?.session?.close();
	}, []);
	useLayoutEffect(() => {
		if (!host) return;
		signal.addEventListener("abort", close, { once: true });
		return () => {
			signal.removeEventListener("abort", close);
			close();
		};
	}, [close, host, signal]);
	useLayoutEffect(() => {
		attempt.current?.session?.setMetadata({ title, artworkUrl });
	}, [title, artworkUrl]);

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
			if (!host || signal.aborted || attempt.current?.sessionId === sessionId)
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
