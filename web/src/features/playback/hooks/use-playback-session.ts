import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../../../components/ui/toast.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import type { PlaybackPolicy } from "../../../config/media-policy.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import {
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

export function usePlaybackSession(fileId: string, policy: PlaybackPolicy) {
	const { t } = useTranslation();
	const { progressSaveIntervalMs, requestTimeoutMs } = policy;
	const stablePolicy = useMemo(
		() => ({ progressSaveIntervalMs, requestTimeoutMs }),
		[progressSaveIntervalMs, requestTimeoutMs],
	);
	const [state, setState] = useState(initialState);
	const controllerRef = useRef<PlaybackSessionController | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
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
				const key =
					getErrorTranslationKey(next.error.cause) ??
					(next.error.operation === "load"
						? "errors.playbackLoad"
						: "errors.playbackSave");
				const signature = `${next.error.operation}:${key}`;
				if (signature === notifiedError) return;
				notifiedError = signature;
				toast.add({
					type: "error",
					priority: "high",
					title: t(key),
					id: notificationId,
					timeout: interactionPolicy.errorToastTimeoutMs,
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
		controller.attach(videoRef.current);
		void controller.open(departures.get(fileId));
		const hide = () => {
			void controller.flush(true);
		};
		window.addEventListener("pagehide", hide);
		return () => {
			window.removeEventListener("pagehide", hide);
			toast.close(notificationId);
			if (controllerRef.current === controller) controllerRef.current = null;
			const departure = controller.dispose();
			departures.set(fileId, departure);
			void departure.finally(() => {
				if (departures.get(fileId) === departure) departures.delete(fileId);
			});
		};
	}, [fileId, stablePolicy, t]);

	const attach = useCallback((video: HTMLVideoElement | null) => {
		videoRef.current = video;
		controllerRef.current?.attach(video);
	}, []);
	return { session: state.session, attach };
}
