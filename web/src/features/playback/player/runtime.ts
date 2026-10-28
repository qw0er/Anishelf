export interface PlaybackFailure {
	kind: "network" | "decode" | "unsupported" | "unknown";
	code: number | null;
}
export function playbackFailure(
	error: Pick<MediaError, "code"> | null,
): PlaybackFailure {
	const code = error?.code ?? null;
	return {
		code,
		kind:
			code === 2
				? "network"
				: code === 3
					? "decode"
					: code === 4
						? "unsupported"
						: "unknown",
	};
}
interface NativeAudioTrack {
	enabled: boolean;
}
interface NativeAudioTracks extends EventTarget {
	readonly length: number;
	[index: number]: NativeAudioTrack;
}
export function nativeAudioTracks(
	video: HTMLVideoElement,
): NativeAudioTracks | undefined {
	return (video as HTMLVideoElement & { audioTracks?: NativeAudioTracks })
		.audioTracks;
}
export function canSelectNativeAudio(): boolean {
	return Boolean(nativeAudioTracks(document.createElement("video")));
}
/** FFmpeg output positions differ from source stream indices. */
export function selectNativeAudio(
	video: HTMLVideoElement,
	position: number,
): boolean {
	const tracks = nativeAudioTracks(video);
	if (!tracks || position < 0 || position >= tracks.length) return false;
	for (let i = 0; i < tracks.length; i++) {
		const track = tracks[i];
		if (track) track.enabled = i === position;
	}
	return true;
}
