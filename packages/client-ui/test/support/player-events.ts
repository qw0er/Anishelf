import type {
	LibmediaPlaybackStatus,
	LibmediaPlayerEvents,
} from "libmedia-react-player";

let nextId = 0;

/** Drives libmedia's callback contract through the existing media fixtures. */
export function playerEvents(
	video: HTMLVideoElement,
	props: () => LibmediaPlayerEvents & {
		initialPositionMs?: number;
		src?: string;
	},
) {
	const sessionId = `fixture-${++nextId}`;
	let status: LibmediaPlaybackStatus = "loading";
	let initialized = false;
	let seeking = false;
	let buffering = false;
	const currentTime = Object.getOwnPropertyDescriptor(
		HTMLMediaElement.prototype,
		"currentTime",
	);
	const progress = () => ({
		src: props().src ?? "/media/fixture",
		sessionId,
		positionMs: video.currentTime * 1000,
		durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : null,
	});
	const snapshot = () => ({
		...progress(),
		status,
		seeking,
		buffering,
		playbackRate: video.playbackRate,
	});
	function state(value: LibmediaPlaybackStatus = status) {
		status = value;
		props().onPlaybackStateChange?.(snapshot());
	}
	Object.defineProperty(video, "currentTime", {
		configurable: true,
		get: () => currentTime?.get?.call(video) ?? 0,
		set: (value: number) => {
			currentTime?.set?.call(video, value);
			props().onTimeUpdate?.(progress());
		},
	});
	function ready(restored = true) {
		if (initialized) return;
		initialized = true;
		const requestedPositionMs = props().initialPositionMs ?? 0;
		video.currentTime = restored
			? Math.min(
					Number.isFinite(video.duration) ? video.duration : Infinity,
					requestedPositionMs / 1000,
				)
			: 0;
		props().onInitialPositionResult?.({
			...progress(),
			requestedPositionMs,
			restored,
		});
		state("ready");
		props().onReady?.(progress());
	}
	const handlers = {
		loadedmetadata: () => ready(),
		playing: () => {
			buffering = false;
			state("playing");
		},
		pause: () => {
			if (status === "paused") state("playing");
			state("paused");
		},
		waiting: () => {
			buffering = true;
			state();
		},
		ratechange: () => state(),
		seeking: () => {
			seeking = true;
			state();
		},
		seeked: () => {
			seeking = false;
			state();
			const settled = progress();
			props().onSeeked?.({
				...settled,
				requestedPositionMs: settled.positionMs,
			});
		},
		timeupdate: () => props().onTimeUpdate?.(progress()),
		ended: () => {
			state("ended");
			props().onEnded?.(progress());
		},
	};
	for (const [name, handler] of Object.entries(handlers))
		video.addEventListener(name, handler);
	state("loading");
	return {
		sessionId,
		ready,
		state,
		snapshot,
		close() {
			for (const [name, handler] of Object.entries(handlers))
				video.removeEventListener(name, handler);
			if (currentTime) Object.defineProperty(video, "currentTime", currentTime);
		},
	};
}
