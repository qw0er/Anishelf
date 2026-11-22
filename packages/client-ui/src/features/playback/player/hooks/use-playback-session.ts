import type { MediaTimeline } from "@anishelf/contracts/media";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { interactionDefaults } from "../../../../shared/config/interaction-defaults.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import type { PlaybackPolicy } from "../policy.js";
import {
	isRetryablePlaybackError,
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../session.js";

// A remount must finish the old save/release before opening another generation.
const departures = new Map<string, Promise<void>>();
const initialState: PlaybackSessionState = {
	session: null,
	loading: true,
	saving: false,
	restored: false,
	error: null,
};

export function usePlaybackSession(
	fileId: string,
	policy: PlaybackPolicy,
	autoPlay = false,
) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const {
		progressSaveIntervalMs,
		requestTimeoutMs,
		progressRetryInitialMs,
		progressRetryMaximumMs,
		progressSeekDelayMs,
	} = policy;
	const stablePolicy = useMemo(
		() => ({
			progressSaveIntervalMs,
			requestTimeoutMs,
			progressRetryInitialMs,
			progressRetryMaximumMs,
			progressSeekDelayMs,
		}),
		[
			progressSaveIntervalMs,
			requestTimeoutMs,
			progressRetryInitialMs,
			progressRetryMaximumMs,
			progressSeekDelayMs,
		],
	);
	const [state, setState] = useState(initialState);
	const autoPlayAttempted = useRef(false);
	const controllerRef = useRef<PlaybackSessionController | null>(null);
	useEffect(() => {
		const notificationId = `playback-progress:${fileId}`;
		let notifiedError: string | null = null;
		const controller = new PlaybackSessionController(
			fileId,
			(next) => {
				setState(next);
				if (!next.error) {
					if (notifiedError) toast.close(notificationId);
					notifiedError = null;
					return;
				}
				const retrying =
					next.error.operation === "save" &&
					isRetryablePlaybackError(next.error.cause);
				const key = retrying
					? "errors.playbackSaveRetrying"
					: (getErrorTranslationKey(next.error.cause) ??
						(next.error.operation === "load"
							? "errors.playbackLoad"
							: "errors.playbackSave"));
				const signature = `${next.error.operation}:${key}`;
				if (signature === notifiedError) return;
				notifiedError = signature;
				toast.add({
					type: "error",
					priority: "high",
					title: t(key),
					id: notificationId,
					timeout: interactionDefaults.persistentToastTimeoutMs,
					actionProps: {
						children: t("actions.retry"),
						onClick: () => {
							if (controllerRef.current === controller) void controller.retry();
						},
					},
				});
			},
			stablePolicy,
		);
		controllerRef.current = controller;
		void controller.open(departures.get(fileId));
		const unsubscribe = getClientRuntime().platform.onPlaybackLifecycle({
			onBackground: () => void controller.flush(true),
			onOnline: () => controller.reconnect(),
		});
		return () => {
			unsubscribe();
			toast.close(notificationId);
			if (controllerRef.current === controller) controllerRef.current = null;
			const departure = controller.dispose();
			departures.set(fileId, departure);
			void departure.finally(() => {
				void client.invalidateQueries({
					queryKey: ["history"],
					refetchType: "none",
				});
				if (departures.get(fileId) === departure) departures.delete(fileId);
			});
		};
	}, [fileId, stablePolicy, t, client]);

	const startContinuation = useCallback(
		async (play: () => Promise<void>, signal: AbortSignal) => {
			if (!autoPlay || autoPlayAttempted.current) return;
			autoPlayAttempted.current = true;
			try {
				await play();
			} catch (error) {
				if (
					signal.aborted ||
					!(error instanceof Error) ||
					error.name !== "NotAllowedError"
				)
					return;
				console.info("[playback] Continuation requires manual playback.", {
					fileId,
				});
				toast.add({
					type: "info",
					title: t("player.continuation.playBlocked"),
					id: `continuation-play:${fileId}`,
				});
			}
		},
		[autoPlay, fileId, t],
	);
	const bind = useCallback(
		(timeline: MediaTimeline, sourceVersion: string) =>
			controllerRef.current?.bind(timeline, sourceVersion) ?? null,
		[],
	);
	return {
		session: state.session,
		bind,
		startContinuation,
	};
}
