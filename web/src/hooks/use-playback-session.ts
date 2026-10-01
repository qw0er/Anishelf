import { useCallback, useEffect, useRef, useState } from "react";
import {
	PlaybackSessionController,
	type PlaybackSessionState,
} from "../playback/session.js";

// A remount must finish the old save/release before opening another generation.
const departures = new Map<string, Promise<void>>();
const initialState: PlaybackSessionState = {
	session: null,
	loading: true,
	saving: false,
	restored: false,
	error: null,
};

export function usePlaybackSession(fileId: string) {
	const [state, setState] = useState(initialState);
	const controllerRef = useRef<PlaybackSessionController | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	useEffect(() => {
		const controller = new PlaybackSessionController(fileId, setState);
		controllerRef.current = controller;
		controller.attach(videoRef.current);
		void controller.open(departures.get(fileId));
		const hide = () => {
			void controller.flush(true);
		};
		window.addEventListener("pagehide", hide);
		return () => {
			window.removeEventListener("pagehide", hide);
			if (controllerRef.current === controller) controllerRef.current = null;
			const departure = controller.dispose();
			departures.set(fileId, departure);
			void departure.finally(() => {
				if (departures.get(fileId) === departure) departures.delete(fileId);
			});
		};
	}, [fileId]);

	const attach = useCallback((video: HTMLVideoElement | null) => {
		videoRef.current = video;
		controllerRef.current?.attach(video);
	}, []);
	return { session: state.session, attach };
}
