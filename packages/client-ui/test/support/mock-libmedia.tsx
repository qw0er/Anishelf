import type {
	LibmediaPlaybackPreferences,
	LibmediaPlayerError,
	LibmediaPlayerProps,
} from "libmedia-react-player";
import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import { vi } from "vitest";
import { playerEvents } from "./player-events.js";

export const mockPlayer = {
	instances: [] as {
		video: HTMLVideoElement;
		props(): LibmediaPlayerProps;
		selectAudio: (streamIndex: number | null) => Promise<void>;
		preference(changes: LibmediaPlaybackPreferences): void;
		track(streamIndex: number | null): void;
		error(error: Omit<LibmediaPlayerError, "sessionId" | "src">): void;
	}[],
	restored: true,
	play: vi.fn(async () => {}),
};

function Fixture(props: LibmediaPlayerProps) {
	const latest = useRef(props);
	const video = useRef<HTMLVideoElement>(null);
	const controls = useRef<ReturnType<typeof playerEvents> | null>(null);
	const selectAudio = useRef(vi.fn(async (_index: number | null) => {}));
	useLayoutEffect(() => {
		latest.current = props;
	}, [props]);
	useLayoutEffect(() => {
		const element = video.current;
		if (!element) return;
		element.setAttribute("src", new URL(latest.current.src).pathname);
		Object.defineProperty(element, "duration", {
			value: 100,
			configurable: true,
		});
		controls.current = playerEvents(element, () => latest.current);
		const session = controls.current;
		const entry = {
			video: element,
			props: () => latest.current,
			selectAudio: selectAudio.current,
			preference(changes: LibmediaPlaybackPreferences) {
				latest.current.onPlaybackPreferenceChange?.({
					src: latest.current.src,
					sessionId: session.sessionId,
					changes,
				});
			},
			track(streamIndex: number | null) {
				latest.current.onTrackChange?.({
					src: latest.current.src,
					sessionId: session.sessionId,
					subtitle: null,
					audio:
						streamIndex === null
							? null
							: { id: streamIndex, streamIndex, label: "Japanese" },
				});
			},
			error(error: Omit<LibmediaPlayerError, "sessionId" | "src">) {
				if (error.fatal) session.state("error");
				latest.current.onError?.({
					...error,
					src: latest.current.src,
					sessionId: session.sessionId,
				});
			},
		};
		mockPlayer.instances.push(entry);
		queueMicrotask(() => {
			if (controls.current === session) session.ready(mockPlayer.restored);
		});
		return () => {
			controls.current = null;
			session.close();
			element.removeAttribute("src");
			element.pause();
			element.load();
			mockPlayer.instances = mockPlayer.instances.filter(
				(instance) => instance !== entry,
			);
		};
	}, []);
	useImperativeHandle(props.ref, () => ({
		play: mockPlayer.play,
		pause: async () => controls.current?.state("paused"),
		seekTo: async (positionMs) => positionMs,
		selectAudio: selectAudio.current,
		retry() {},
		getSnapshot() {
			if (!controls.current) throw new Error("Missing player instance.");
			return controls.current.snapshot();
		},
	}));
	return (
		<>
			<video ref={video} aria-label={props.labels?.player}>
				<track kind="captions" />
			</video>
			{props.onNextEpisode && (
				<button type="button" onClick={props.onNextEpisode}>
					{props.labels?.nextEpisode}
				</button>
			)}
		</>
	);
}

vi.mock("libmedia-react-player", () => ({ LibmediaPlayer: Fixture }));
